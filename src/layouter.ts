import { Classifier, Compartment, Config, Measurer, RelationLabel, Style } from "./domain"
import { indexBy } from "./util"
import { Vec } from "./vector"
import { layout as grapheLayout, graphlib } from "graphre"
import { layouters, styles } from "./visuals"
import { EdgeLabel, GraphLabel, GraphNode } from "graphre/decl/types"

type Quadrant = 1|2|3|4

export function layout(measurer: Measurer, config: Config, ast: Compartment): Compartment {

	function measureLines(lines: string[], fontWeight: 'normal'|'bold'){
		if (!lines.length)
			return { width: 0, height: config.padding }
		measurer.setFont(config, fontWeight, null)
		return {
			width: Math.round(Math.max(...lines.map(measurer.textWidth)) + 2*config.padding),
			height: Math.round(measurer.textHeight() * lines.length + 2*config.padding)
		}
	}
	
	function layoutCompartment(c: Compartment, compartmentIndex: number, style: Style){
		var textSize = measureLines(c.lines, compartmentIndex ? 'normal' : 'bold')

		if (!c.nodes.length && !c.relations.length){
			c.width = textSize.width
			c.height = textSize.height
			c.offset = { x: config.padding, y: config.padding }
			return
		}

		var styledConfig = { ...config, direction: style.direction ?? config.direction }
		c.nodes.forEach(e => layoutClassifier(e, styledConfig))

		var g = new graphlib.Graph<GraphLabel, GraphNode, EdgeLabel & { id: number }>()
		g.setGraph({
			rankdir: style.direction || config.direction,
			//align: //undefined [UL, UR, DL, DR]
			nodesep: config.spacing, //50 
			edgesep: config.spacing, //10 
			ranksep: config.spacing, //50 
			//marginx: //0 
			//marginy: //0 
			acyclicer: config.acyclicer,
			ranker: config.ranker
		});
		for(var e of c.nodes){
			g.setNode(e.name, { width: e.layoutWidth, height: e.layoutHeight })
		}
		for(var r of c.relations){
			if (r.assoc.indexOf('_') > -1){
				g.setEdge(r.start, r.end, { id: r.id, minlen: 0 })
			} else if ((config.gravity ?? 1) != 1){
				g.setEdge(r.start, r.end, { id: r.id, minlen: config.gravity })
			} else {
				g.setEdge(r.start, r.end, { id: r.id })
			}
		}
		grapheLayout(g)

		var rels = indexBy(c.relations, 'id')
		var nodes = indexBy(c.nodes, 'name')
		g.nodes().forEach(function(name: string) {
			var node = g.node(name)
			nodes[name].x = node.x!
			nodes[name].y = node.y!
		})
		var left = 0
		var right = 0
		var top = 0
		var bottom = 0
		g.edges().forEach(function(edgeObj) {
			var edge = g.edge(edgeObj)
			var start = nodes[edgeObj.v]
			var end = nodes[edgeObj.w]
			var rel = rels[edge.id]
			rel.path = [start, ...edge.points!, end].map(toPoint)
			
			var startP = rel.path[1];
			var endP = rel.path[rel.path.length - 2];
			layoutLabel(rel.startLabel, startP, adjustQuadrant(quadrant(startP, start, 4), start, end));
			layoutLabel(rel.endLabel, endP, adjustQuadrant(quadrant(endP, end, 2), end, start));
			left = Math.min(left, rel.startLabel.x!, rel.endLabel.x!, ...edge.points!.map(e => e.x), ...edge.points!.map(e => e.x))
			right = Math.max(right, rel.startLabel.x! + rel.startLabel.width!, rel.endLabel.x! + rel.endLabel.width!, ...edge.points!.map(e => e.x))
			top = Math.min(top, rel.startLabel.y!, rel.endLabel.y!, ...edge.points!.map(e => e.y))
			bottom = Math.max(bottom, rel.startLabel.y! + rel.startLabel.height!, rel.endLabel.y! + rel.endLabel.height!, ...edge.points!.map(e => e.y))
		})
		var graph = g.graph()
		var width = Math.max(graph.width!, right - left)
		var height = Math.max(graph.height!, bottom - top)
		var graphHeight = height ? height + 2*config.gutter : 0
		var graphWidth = width ? width + 2*config.gutter : 0

		c.width = Math.max(textSize.width, graphWidth) + 2*config.padding
		c.height = textSize.height + graphHeight + config.padding
		c.offset = { x: config.padding - left, y: config.padding - top }
	}

	function toPoint(o: Vec): Vec {
		return { x:o.x, y:o.y }
	}
	
	function layoutLabel(label: RelationLabel, point: Vec, quadrant: Quadrant) {
		if (!label.text) {
			label.width = 0
			label.height = 0
			label.x = point.x
			label.y = point.y
		} else {
			var fontSize = config.fontSize
			var lines = label.text.split('`')
			label.width = Math.max(...lines.map(function(l){ return measurer.textWidth(l) })),
			label.height = fontSize*lines.length
			label.x = point.x + ((quadrant==1 || quadrant==4) ? config.padding : -label.width - config.padding),
			label.y = point.y + ((quadrant==3 || quadrant==4) ? config.padding : -label.height - config.padding)
		}
	}

	// find basic quadrant using relative position of endpoint and block rectangle
	function quadrant(point: Vec, node: Classifier, fallback: Quadrant): Quadrant {
		if (point.x < node.x && point.y < node.y) return 1;
		if (point.x > node.x && point.y < node.y) return 2;
		if (point.x > node.x && point.y > node.y) return 3;
		if (point.x < node.x && point.y > node.y) return 4;
		return fallback;
	}

	// Flip basic label quadrant if needed, to avoid crossing a bent relationship line
	function adjustQuadrant(quadrant: Quadrant, point: Vec, opposite: Vec): Quadrant {
		if ((opposite.x == point.x) || (opposite.y == point.y)) return quadrant;
		var flipHorizontally: Quadrant[] = [4, 3, 2, 1]
		var flipVertically: Quadrant[] = [2, 1, 4, 3]
		var oppositeQuadrant = (opposite.y < point.y) ?
							((opposite.x < point.x) ? 2 : 1) :
							((opposite.x < point.x) ? 3 : 4);
		// if an opposite relation end is in the same quadrant as a label, we need to flip the label
		if (oppositeQuadrant === quadrant) {
			if (config.direction === 'LR') return flipHorizontally[quadrant-1];
			if (config.direction === 'TB') return flipVertically[quadrant-1];
		}
		return quadrant; 	
	
	}
	
	function layoutClassifier(clas: Classifier, config: Config): void {
		var style = config.styles[clas.type] || styles.CLASS
		clas.compartments.forEach(function(co,i){ layoutCompartment(co, i, style) })
		layouters[style.visual](config, clas)
		clas.layoutWidth = clas.width + 2*config.edgeMargin
		clas.layoutHeight = clas.height + 2*config.edgeMargin
	}
	function treeRelayout(c:Compartment, config?: Config):[number, number]{
		const relStartMap:Map<string, any[]> = new Map();
		const relEndMap:Map<string, any> = new Map();
		const nodeMap:Map<string, Classifier> = new Map();
		const movedNodeMap:Map<string, Classifier> = new Map();
		let deepest:number=0;
		let widest:number=0;
		let depths:number[]=Array();
		const padtop=20
		const padright=10
		let rootNode:TreeClassifier|undefined=undefined;

		const ensureColumnDepth=(column: number)=>{
			if(depths.length<=column){
				for (let i = 0; i < (column+1)-depths.length; i++) {
					depths.push(0);		
				}
			}
		}
		const setColumnDepth = (node:TreeClassifier)=>{
			if(!node)return;
			ensureColumnDepth(node.column||0);
			//depths[node.column||0] = (depths[node.column||0]||0)+node.height+padtop;
			const depth=node.y+(node.height/2)+padtop
			const width=node.x+(node.width/2)+padright
			if(depth>deepest)deepest=depth
			if(width>=widest)widest=width
			depths[node.column||0]=depth
		}

		const maxDepth = (column: number, span:number):number=>{
			const includedDepths:number[]=new Array()
			const maxCol = (depths.length>column+span)?column+span+1:depths.length
			for (let i = column; i < maxCol; i++) {
				includedDepths.push(depths[i])		
			}
			return Math.max(...includedDepths)
		}

		const setTallest = (node:Classifier):void=>{
			const bottom = node.y+(node.height/2)
			if(bottom<deepest)return;
			//deepest=bottom;
		}

		const updateRel=(rel:any):void=>{
			const nodeEnd = nodeMap.get(rel.end)
			if(!nodeEnd)return;
			const endTop = nodeEnd.y-(nodeEnd.height/2)
			const endY = endTop + 15
			rel.path[2].y = endY
			rel.path[3].y = endY
			rel.path[4].y = endY
			
			const nodeStart = nodeMap.get(rel.start)
			if(!nodeStart)return;
			const startTop = nodeStart.y-(nodeStart.height/2)
			const startY = startTop + 15
			//rel.path[0].y = startY
			rel.path[1].y = startY

			if(rel.path[1].y<rel.path[2].y)rel.path[1].x = rel.path[2].x

		}
		const alignTop = (node:Classifier, withNode:Classifier):void=>{
			if(node.name.toLowerCase().startsWith('root')){
				console.log('align top', node.name, withNode?.name, movedNodeMap.has(withNode.name))
			}
			const refTop = withNode.y-(withNode.height/2)
			const targetY = refTop +(node.height/2)
			node.y = targetY;
		}

		const addChild=(parent:TreeClassifier, child:Classifier):void=>{
			if(!parent)return;
			if(!parent.children)parent.children = new Array();
			parent.children.push(child)
		}

		const updateParent = (n:TreeClassifier, descendants:TreeClassifier[]=new Array()):void=>{
			setTallest(n)
			const rel = relEndMap.get(n.name);
			//NODE THAT DOESN'T HAS ROLE AS END NODE IS ROOT
			if(!rel){
				n.column=0;
				let c = 0;
				console.log('ROOT, WCODM NONOML VERSION 1.5.2-beta.6')
				//FORCE ROOT TOP to ZERO
				n.y=n.height/2
				for (const child of descendants||[]) {
					alignTop(child, n)
					child.column = (descendants||[]).length-c
					setColumnDepth(child)
					c++;
				}
				return
			};
			const parentNode: TreeClassifier|undefined = nodeMap.get(rel.start);
			if(!parentNode)return;

			//IF THE PARENT IS NOT BELOW THE CURRENT NODE, THEN DO NOTHING AS IT LIKELY MOVED
			if(movedNodeMap.has(parentNode.name)){
				n.column = (parentNode.column||0)+1;
				const deepest = maxDepth(n.column||0, descendants.length)
				//padSibling(n, parentNode)
				n.y = deepest+(n.height/2)

				setColumnDepth(n)
				addChild(parentNode, n);
				let i = 0;
				for (const child of descendants||[]) {
					alignTop(child, n)
					child.column = ((descendants||[]).length-i)+n.column
					setColumnDepth(child)
					i++;
				}
				return
			};

			alignTop(parentNode, n)
			addChild(parentNode, n);
			descendants.push(n);
			movedNodeMap.set(parentNode.name, parentNode);
			updateParent(parentNode, descendants);
		}
		const findLeave = (node: TreeClassifier|undefined)=>{
			if(!node)return;
			const rels = relStartMap.get(node.name);
			if(!rels || rels.length<=0){
				// THIS IS A LEAVE
				updateParent(node);

			}
			node.members = node.members||[];
			for (const rel of rels||[]) {
				const child = nodeMap.get(rel.end)
				if(!child)continue
				node.members.push(child)
				findLeave(child)
			}
		}
		for (const rel of c.relations||[]) {
			if(!relStartMap.has(rel.start))relStartMap.set(rel.start, new Array())
			relStartMap.get(rel.start)?.push(rel)
			relEndMap.set(rel.end, rel)
		}
		for (const node of c.nodes || []) {
			nodeMap.set(node.name, node);
			//THIS NODE IS ROOT
			if(relStartMap.has(node.name) && !relEndMap.has(node.name))rootNode = node;
			//console.log('REG NODE ', node.name)
		}
		findLeave(rootNode)
		//console.log('ROOT STATUS, ', rootNode)
		for (const rel of c.relations||[]) {
			updateRel(rel)
		}
		return [deepest, widest]
	}
	layoutCompartment(ast, 0, styles.CLASS)
	if(!!config?.alignTop){
		const [deeptest, widest] = treeRelayout(ast)
		ast.height = deeptest+30
		//ast.width = widest + 20
		console.log('PROBE AST WIDTH', ast.width, widest)
	}
	return ast
}

type TreeClassifier = Classifier & {children?:TreeClassifier[], column?:number, members?:TreeClassifier[]}
