//====================================
// dfatool.js
// JavaScript Data Flow Analyze Tool
//
// author Yi Shen(bm2736892@gmail.com)
//====================================

var codegen = require("escodegen");
var fs = require("fs");

var TEMPLATE_BLOCK = function(body){
	return {
		"type" : "BlockStatement",
		"body" : body || []
	}
}
var TEMPLATE_IDENTIFIER = function(name){
	return {
		"type": "Identifier",
		"name": name || "__anoymous__"
	}
}
var TEMPLATE_FUNCTION_DECLARATION = function(id, params, body){
	return {
		"type": "FunctionDeclaration",
		"id": TEMPLATE_IDENTIFIER(id),
		"params" : params || [],
		"defaults" : [],
		"body" : body || TEMPLATE_BLOCK(),
		"rest" : null,
		"generator" : false,
		"expression" : false
	}
}
var TEMPLATE_ASSIGNMENT_STATEMENT = function(left, right, operator){
	return {
		"type" : "AssignStatement",
		"left" : left || TEMPLATE_IDENTIFIER(),
		"right" : right || TEMPLATE_IDENTIFIER(),
		"operator" : operator || "="
	}
}

var TEMPLATE_VARIABLE_DECLARATOR = function(id){
	return {
		"type" : "VariableDeclarator",
		"id" : TEMPLATE_IDENTIFIER(id),
		"init" : null
	}
}

var TEMPLATE_OBJECT_EXPRESSION = function(properties){
	return {
		"type" : "ObjectExpression",
		"properties" : properties || []
	}
}

var TEMPLATE_LITERAL_EXPRESSION = function(val){
	return {
		"type" : "Literal",
		"value" : val,
		"raw"	: val.toString()
	}
}

var TEMPLATE_ARRAY_EXPRESSION = function(){
	return {
		"type" : "ArrayExpression",
		"elements" : []
	}
}
var TEMPLATE_BINARY_EXPRESSION = function(operator, left, right){
	return {
		"type" : "BinaryExpression",
		"operator" : operator,
		"left" : left,
		"right" : right
	}
}
var TEMPLATE_UNARY_EXPRESSION = function(arg){

}
//=====================================
// abstract syntax tree traverse (none-recursive)
// it is easily to have stack overflow when traverse the ast recursively
// -before is for pre-order traverse
// -after is for post-order traverse
// -isReplaceReference {Boolean|Function}
//=====================================
function walk(root, before, after, isReplaceReference){

	if( ! root){
		return;
	}
	var _stack = [];

	if(Array.isArray(root)){
		root.forEach(function(child){
			walk(child, before, after, isReplaceReference);
		})
		return ;
	}
	var node = root;

	// save the node which has been replaced by its reference
	// in case of Circular Reference
	var _expanded = [];
	
	if( ! isFunction( isReplaceReference ) ){
		var _isReplaceReference = isReplaceReference;
		isReplaceReference = function(){
			return _isReplaceReference;
		}			
	}
	while(node){
		if( ! node.__visited__){

			if( isReplaceReference( node ) ){

				node = replaceReference( node );
				// return false when has a circular reference
				if( ! node){
					next();
					continue;
				}
			}
			// call before visiting any of its children
			// return false to skip the children
			// return an ast if you wan't to replace it
			var res = before(node);

			// skip its chilren when return false
			if( ! res){
				res = after && after(node);
				if( res && res.type ){
					replaceNode(res);
				}
				next();
				continue;
			}else if(res.type){	//replace the node if res is an new ast node
				replaceNode(res);
				//change the walking node
				node = res;
			}

			var tmp = inferenceChildren(node ),
				children = tmp.children,
				map = tmp.map;
			// push parent node to stack
			if(children && children.length){
				
				_stack.push(node);
				node.__childidx__ = -1;
				node.__children__ = children;
				node.__map__ = map;

				node.__visited__ = true;

				next();

			}else{	//leaf
				
				var res = after && after(node);
				if( res && res.type ){
					replaceNode(res);
				}

				next();
			}

		}else{
			// clean the ast node;
			delete node.__visited__;
			delete node.__childidx__;
			delete node.__children__;
			delete node.__map__;

			if( after ){
				// call after all its children visited
				res = after(node);
				if( res && res.type ){
					replaceNode(res);
				}
			}

			delete node.origin;

			next();

			continue;
		}
	}

	function replaceReference(_node){

		if( _node.reference ){
			// solve circular reference
			if( _expanded.indexOf(_node)>=0 ){
				log("Circular Reference:", _node);
				return false;
			}

			var ref = getReference( _node );

			if( _stack.indexOf(ref.ast)>=0 ){
				log("Circular Reference AST:", _node);
				return false;
			}
			_expanded.push(_node);

			var origin = _node;
			// replace the reference ast node
			if(ref.type == "array"){
				_node = rebuildArray(ref, origin);
			}else if(ref.type == "object"){
				_node = rebuildObject(ref, origin);
			}else{
				_node = ref.ast;
			}
			_node.origin = origin;
		}

		return _node;
	}

	function rebuildArray( ref, origin ){
		var _node = TEMPLATE_ARRAY_EXPRESSION();
		ref.elements.forEach(function(value){
			if( value.type == "array"){
				var elem = rebuildArray( value, origin);
			}else if(value.type == "object"){
				var elem = rebuildObject( value, origin);
			}else{
				var elem = value.ast;
			}
			_node.elements.push( elem );
		})
		_node.loc = deepCloneAst( origin.loc);
		_node.scope = ref.scopeSvForRebuild;

		return _node;
	}

	function rebuildObject( ref, origin ){
		var _node = TEMPLATE_OBJECT_EXPRESSION();
		for(var key in ref.props){
			var prop = ref.props[key];
			if(prop){
				if( prop.type == "array"){
					var propAst = rebuildArray( prop, origin);
				}else if(prop.type == "object"){
					var propAst = rebuildObject( prop, origin);
				}else{
					var propAst = prop.ast;
				}
				var item = {
					"type" : "Property",
					"key" : TEMPLATE_LITERAL_EXPRESSION( ref.withoutPrefix(key) ),
					"value" : propAst,
					"kind" : "init",	//other kinds?
					"loc" : null
				}
				_node["properties"].push(item);
			}
		}
		_node.loc = deepCloneAst( origin.loc );
		_node.scope = ref.scopeSvForRebuild;
		return _node;
	}

	function replaceNode(_node){
		
		//replace 
		if(_stack.length == 0){
			root = _node;
			return
		}
		var parent = _stack[_stack.length-1],
			idx = parent.__childidx__,
			value = parent.__map__[idx];

		var tmp = value.split("__"),
			propName = tmp[0],
			index = tmp[1];

		if(index){
			parent[propName][index] = _node;
		}else{
			parent[propName] = _node;
		}
	}

	function next(){
		var parent = _stack[_stack.length-1];
		if( parent ){
			if( ! parent.__children__ ){
				console.log("okk");
			}
			var sibling = parent.__children__[ ++parent.__childidx__ ];
			if( ! sibling ){
				// back to parent
				node = _stack.pop();
			}else{
				if( sibling.__visited__ ){
					log("Circular AST:", sibling);
					next();
					return;
				}
				node = sibling;
			}
		}else{
			node = null;
		}
	}

	function inferenceChildren(node){
		var children = [],
			map = [];	//map is for reconstruct the ast
						//the impletation is ugly
		for(var propName in node){
			var prop = node[propName];
			//flatten
			if( prop && 
				prop.type &&
				(propName!="reference") &&
				(propName!="origin") ){

				children.push(prop);
				map.push(propName);
			}else if( Array.isArray(prop) &&
					propName != "__children__" &&
					propName != "__map__" ){

				for(var i = 0; i < prop.length; i++){
					children.push(prop[i]);
					map.push(propName+"__"+i);
				}
			}
		}
		return {
			children : children,
			map : map
		}
	}

	return root;

}

function deepCloneAst(ast){
	if( ! ast){
		return ast;
	}
	if( ast.constructor == Array ){
		var ret = [];
		for(var i = 0; i < ast.length; i++){
			ret[i] = deepCloneAst(ast[i]);
		}
		return ret;
	}
	else if(ast.constructor == Object){
		var ret = {};
		for(var propName in ast){
			if( propName == "__map__" ||
				propName == "origin" ||
				propName == "__children__" ||
				propName == "__childidx__"){
				continue;
			}
			ret[propName] = deepCloneAst(ast[propName]);
		}
		if(ast.scope){
			ret.scope = ast.scope;
		}
		if(ast.reference){
			ret.reference = ast.reference;
		}
		return ret;
	}
	else{
		return ast;
	}
}

//==============================================
// Scope Object of Function
//==============================================
var Scope = function(parent){

	this.id = Scope.generateID();

	if( parent ){
		this.parent = parent;
		parent.children.push( this);
	}
	this.children = [];

	// variables and functions defined in this scope;
	this._defines = {};
	// arguments and this object;
	this._closure = {};
	// varialbles modified in this scope and define in parent scope;
	this._modified = {};
	// program location where the function is implement
	this._baseLoc = 0;

	// pending statement
	// when variable in the lhs of assignstatement can't find in the scope
	// it will be added to pendinglist
	this._pending = [];
	// _caller scope;
	this._caller = null;
	// location in caller scope when called
	this._callloc = 9999999;

	// statement using anoymous function for solving
	// like (function(g){
	//			g['method'] = someMethod()
	//		})(window)
	this._anoymousStatements = [];

	this._return = new Variable("return", this);

}
Scope.generateID = createIDGenerator();

// add a prefix to avoid override to native method
Scope.prototype._prefix = "v_";
Scope.prototype.withPrefix = withPrefix;
Scope.prototype.withoutPrefix = withoutPrefix;
// define a variable
Scope.prototype.define = function(identifier){
	if(	isUndefined( this.getDefine(identifier) ) ){
		this._defines[ this.withPrefix(identifier) ] = new Variable(identifier, this);
	}
	return this.getDefine(identifier );
}
Scope.prototype.setDefine = function(identifier, variable){
	this._defines[ this.withPrefix(identifier) ] = variable;
	return variable;
}
Scope.prototype.getDefine = function(identifier){
	return this._defines[ this.withPrefix(identifier) ];
}
Scope.prototype.setClosure = function(identifier, variable){
	this._closure[ this.withPrefix(identifier) ] = variable;
	return variable;
}
Scope.prototype.getClosure = function(identifier){
	return this._closure[ this.withPrefix(identifier) ];
}
Scope.prototype.modify = function(identifier, modified){
	this._modified[ this.withPrefix(identifier) ] = modified;
	return modified
}
Scope.prototype.getModified = function(identifier){
	return this._modified[ this.withPrefix(identifier) ];
}
Scope.prototype.getReturn = function(){
	return this._return;
}
//-return  {AssignStatement}
Scope.prototype.assign = function(lhs, rhs, loc){

	var res = this.inferenceVariable(lhs);
	
	if( res && res.variable ){

		var variable = res.variable;
		var identifier = variable.name;

		if( variable.scope == this ){	//in scope
			if( ! (res.accessPath && res.accessPath.length) ){
				return variable.assign(rhs, loc);
			}else{
				return variable.assignProperty(res.accessPath, rhs, loc);
			}
		}else if( this.inScope(variable.scope) ){
			// keep the scope clean
			// soft update of the value in the parent scope
			// it will convert to an strong update when the function is called
			var modified = this.getModified(identifier);
			if( ! modified ){
				modified = this.modify( identifier, new Modified(identifier, variable.scope, this) );
			}
			if( ! res.accessPath ){
				return modified.assign(rhs, loc);
			}else{
				return modified.assignProperty(res.accessPath, rhs, loc);
			}
		}else{
			// may be have an invalid access to the variable in the other scope?
			// or anoymous function or object
		}
	
	}
	// bad case
	else if( lhs.type == "Identifier"){
		var globalScope = this.getGlobalScope();
		var variable = globalScope.define(lhs.name);
		if( globalScope == this){
			variable.assign( rhs, loc);
		}else{
			log("Warning, maybe forget define ", lhs)
		}
	}
	else{
		// here loc is correspond to an id
		if( ! this._pending.filter(function(item){
			return item.loc == loc;
		}).length ){
			this._pending.push({
				lhs : lhs,
				rhs : rhs,
				loc : loc
			})
		}
		return null;
	}
}
// for call expression module.foo(), accessExpr is module.foo, useExpr is whole module.foo()
Scope.prototype.use = function(accessExpr, useExpr, loc){
	var res = this.inferenceVariable( accessExpr );
	if( res ){

		var variable = res.variable;
		if( variable){
			var identifier = variable.name;

			if( variable.name == "__anoymous__"){
				var anoymousStatement = new UseStatement(useExpr, this);
				this._anoymousStatements.push(anoymousStatement);
			}else if( variable.scope == this ){	// in scope
				return variable.use( useExpr, loc);
			}else if( this.inScope(variable.scope) ){
				var modified = this.getModified(identifier);
				if( ! modified ){
					var modified = this.modify( identifier, new Modified(identifier, variable.scope, this) );
				}
				return modified.use( useExpr, loc );
			}else{
				var anoymousStatement = new UseStatement(useExpr, this);
				this._anoymousStatements.push(anoymousStatement);
			}

		}
	}

}
Scope.prototype.inScope = function(scope){
	var parent = this.parent;
	while( parent && parent != scope){
		parent = parent.parent;
	}
	return parent;
}
// expression can be ast of object.key, object["key1"], getObject().key....
// 				or the identifier string of variable
// -return [accessPath, variable]
Scope.prototype.inferenceVariable = function(expression){

	// use the scope where the ast is created to simulate closure when the ast is transferrd by function call
	var closureScope = expression.scope || this;
	if( expression.type == "ThisExpression"){
		if( expression.reference ){
			return {
				ret : null,
				variable : getReference( expression ).targetVariable
			}
		}

		var identifier = "this";
		var definedScope = closureScope.findDefinedScope(identifier);
		var ret = {
			accessPath : null,
			variable : definedScope.getDefine(identifier) || definedScope.getClosure(identifier)
		}
		return ret;
	}
	else if( expression.type == "Identifier"){
		// use the reference directly if the expression has already been expanded
		if( expression.reference ){
			return {
				ret : null,
				variable : getReference( expression ).targetVariable
			}
		}

		var identifier = expression.name;
		var definedScope = closureScope.findDefinedScope(identifier);
		var ret = {
			accessPath : null,
			variable : definedScope.getDefine(identifier) || definedScope.getClosure(identifier)
		}
		return ret;

	}else if(expression.type == "MemberExpression"){
		var	root = expression.object,
			accessPath = [expression.property];

		while( root.type == "MemberExpression" ){
			accessPath.unshift( root.property );
			root = root.object;
		}

		// root must be an variable point to an object target
		// or an anoymous object
		if( root.type == "Identifier"){
			var ret = closureScope.inferenceVariable( root );
			if( ret){
				ret.accessPath = accessPath;
				return ret;
			}
		}
		else if(root.type == "ThisExpression"){
			return {
				variable : closureScope.getClosure("this"),
				accessPath : accessPath
			}
		}
		else if(root.type == "CallExpression"){
			var func = this.inferenceValue( root["callee"], this.offsetLoc(root["callee"].loc.start) );
			if( func && func.type == "function" ){
				var res = func.execute( root, this );
				if( ! res){
					return;
				}
				if( ! res.inference() ){
					log("Function Return Undefined Value", root);
				}else{
					var ret = {
						variable : res,
						accessPath : accessPath
					}
					return ret;
				}
			}
		}
		else if(root.type == "ObjectExpression" ||
				root.type == "ArrayExpression"){
			return {
				variable : Variable.createAnoymous(root),
				accessPath : accessPath
			}
		}else if(root){
			// log("Unkown Expr Type: "+root.type, origin);
		}else{
			log("Undefined Root", expression);
		}
	}
	//here object expression, array expression and function expression is mainly from the derivation result from other expression
	//in use statement
	else if(expression.type == "FunctionExpression" ||
			expression.type == "ObjectExpression" ||
			expression.type == "ArrayExpression"){
		return {
			variable : Variable.createAnoymous(expression),
			accessPath : accessPath
		}
	}
}
// -loc will be used when the expression is created in this scope
// -return {AssignStatement}
Scope.prototype.inferenceValue = function(expression, loc){
	var closureScope = expression.scope || this;		//defined scope
												//this.scope is the used scope
	var res = closureScope.inferenceVariable(expression);
	// pending while res will be undefined
	if( ! (res && res.variable ) ){
		log("InvalidReference", expression);
		return;
	}
	var	variable = res.variable;
	// anoymous variable return the value instantly
	if( variable.name == "__anoymous__" ){
		var value = variable.inference( res.accessPath );
	}
	else if( variable.scope == this){
		var value = variable.inference(loc, res.accessPath);
	}
	else{
		// is called in the ancestor's scope
		// and the variable is defined in one scope of the caller chain
		// in this situation we will need to guess the value based on the call statement location;
		// walk through the call chain and find the scope where the variable is defined
		var caller = this._caller,	//todo: this._caller or scope._caller ?
			callerLoc = this._callloc
		while(caller && caller != res.scope){
			if( ! this.inScope(caller) ){
				caller = null;
				break;
			}
			callerLoc = caller._callloc;
			caller = caller._caller;
		}
		if( caller ){
			var value = variable.inference(callerLoc, res.accessPath );
		}else{
			// get the latest value
			var value = variable.inference(res.accessPath);
		}
	}
	if( ! value){
		log("Warning:"+gencode(expression)+" is undefined");
	}
	return value;
}

// find the scope where the given variable is defined;
Scope.prototype.findDefinedScope = function(identifier){
	
	var scope = this;
	while(scope){
		if( scope.getDefine(identifier) || scope.getClosure(identifier) ){
			return scope;
		}
		else if( ! scope.parent){
			// suppose the value is in the global scope
			return scope;
		}else{
			scope = scope.parent;
		}
	}
}

Scope.prototype.clear = function(){
	
	for(var name in this._defines){
		this._defines[name].clear();
	}
	for(var name in this._modified){
		this._modified[name].clear();
	}
	this._return.clear();
	this._closure = [];
	this._caller = null;
	this._callloc = 0;

	walk( this.ast, function(node){
		delete node.reference;
		return true;
	})
}

Scope.prototype.initialize = function(){

	var scope = this;

	function initializeInBranch( ast, currentBranch ){

		walk( ast, function( node){
			var scope = node.scope;

			switch(node.type){
				case "FunctionDeclaration":
					// function declaration can be defined in anywhere so we set the loc 0;
					var dfNode = scope.assign(node["id"], node, 0 );
					if( currentBranch && dfNode){
						dfNode.conditionalStatement = currentBranch;
					}
					return false;
				case "VariableDeclarator":
					if( node["init"]){
						var dfNode = scope.assign(node["id"], node["init"], scope.offsetLoc(node.loc.end) );
						if( currentBranch && dfNode ){
							dfNode.conditionalStatement = currentBranch;
						}
						return false;
					}
					break;
				case "AssignmentExpression":
					// support the chained assign statement like "module.q = module.Q = module.dom.q"; 
					// will be convert to module.Q = module.dom.q; module.q = module.dom.q
					var leftNodes = [node.left],
						rightMost = node.right;
					while( rightMost.type == "AssignmentExpression" ){
						leftNodes.unshift(rightMost.left);
						rightMost = rightMost.right;
					}
					leftNodes.forEach(function(leftNode){
						var dfNode = scope.assign( leftNode, rightMost, scope.offsetLoc(node.loc.end) );
						if( currentBranch && dfNode ){
							dfNode.conditionalStatement = currentBranch;
						}
					})
					return false;
				case "ExpressionStatement":
					// if the statement is a single call expression
					if(node["expression"]["type"] == "CallExpression"){
						var expr = node["expression"];
						var dfNode = scope.use( expr["callee"], expr, scope.offsetLoc(node.loc.end) );
						if( currentBranch && dfNode ){
							dfNode.conditionalStatement = currentBranch;
						}
						return false;
					}
					break;
				case "ReturnStatement":
					if( ! node["argument"]){	//statement is "return;"
						return;
					}
					var dfNode = scope._return.assign( node["argument"], scope.offsetLoc(node.loc.end) );
					if( currentBranch && dfNode ){
						dfNode.conditionalStatement = currentBranch;
					}
					return false;
				case "IfStatement":
					var consequent = new ConditionalStatement( currentBranch );
					consequent.start = scope.offsetLoc( node["consequent"].loc.start );
					consequent.end = scope.offsetLoc( node["consequent"].loc.end );
					consequent.or( node["test"] );

					initializeInBranch( node["consequent"], consequent );
					if( node["alternate"] ){
						var alternate = new ConditionalStatement( currentBranch );
						alternate.start = scope.offsetLoc( node["alternate"].loc.start );
						alternate.end = scope.offsetLoc( node["alternate"].loc.end );
						consequent.alternate = alternate;
						initializeInBranch( node["alternate"], alternate);
					}
					return false;
				case "SwitchStatement":
					var discriminant = node["discriminant"];
					// todo consider the situation of case without break statement;
					node["cases"].forEach(function(_case){
						if( ! _case.test ){	// todo, when the case have no test expression
							return;
						}
						test = TEMPLATE_BINARY_EXPRESSION("==", discriminant, _case.test);
						test.loc = _case.test.loc;
						test.scope = scope;
						var consequent = new ConditionalStatement( currentBranch );
						consequent.or(test);
						consequent.start = scope.offsetLoc( _case.loc.start );
						consequent.end = scope.offsetLoc( _case.loc.end );

						initializeInBranch( _case["consequent"], consequent);
					})
					return false;
			}

			return true;

		} )
	}

	initializeInBranch( this.ast, null );
}
// spread the expression of each value to a fix point
// -worklist is an array of derivable items(which has a derivation method)
Scope.prototype.derivation = function(worklist /*optional*/, getWorkListFilter/*optional*/, order /*optional*/){
	if( isFunction(worklist) ){
		order = getWorkListFilter;
		getWorkListFilter = worklist;
		worklist = this.getWorkList();
	}else if( isNumber(worklist) ){
		order = worklist;
		getWorkListFilter = exports.getDefaultWorklistFilter;
		worklist = this.getWorkList();
	}
	if( ! worklist){
		worklist = this.getWorkList();
	}
	if( ! getWorkListFilter ){
		getWorkListFilter = exports.getDefaultWorklistFilter;
	}
	var	order = order || 1;	// default 1-order derivation

	worklist.sort(function(a,b){
		return a.loc - b.loc;
	})

	var worklistFilter = getWorkListFilter(this, worklist);

	// wrap the worklistfilter
	var count = 0;

	while(worklist.length && count < order){
		var passResult = [];
		worklist.forEach(function(derivableItem){
			if( worklistFilter && worklistFilter(derivableItem) ){
				passResult.push( derivableItem );
			}
		}, this)
		this.solvePending();
		worklist = passResult;

		count++;
	}
}
Scope.prototype.solvePending = function(){
	this._pending.forEach(function(item){
		if( this.assign(item.lhs, item.rhs, item.loc) ){
			// remove the item;
			this._pending = this._pending.filter(function(a){
				return a != item;
			})
		}
	}, this);
}

Scope.prototype.getWorkList = function(){
	
	var worklist = [];

	for(var name in this._defines){
		addVariable( this._defines[name] );
	}
	for(var name in this._closure){
		addVariable( this._closure[name]  );
	}
	for(var name in this._modified){
		addVariable( this._modified[name] );
	}
	addVariable( this._return );

	function addVariable(variable){
		variable._chain.forEach(function(node){
			worklist.push( node );
		})
	}
	this._anoymousStatements.forEach(function(stat){
		worklist.push(stat);
	}, this)

	return worklist;
}
// offset location of the function
Scope.prototype.offsetLoc = function(loc){
	if( ! this._baseLoc && this.ast){
		this._baseLoc = calculateLoc(this.ast.loc.start);
	}
	return calculateLoc(loc) - this._baseLoc;
}

function calculateLoc( loc ){

	return loc.line + loc.column / 200;

}

Scope.prototype.traverse = function(before, after){

	before && before(this);
	this.children.forEach(function(scope){
		scope.traverse(before, after);
	})
	after && after(this);
}

Scope.prototype.getGlobalScope = function(){
	var ret = this;
	while(ret.parent){
		ret = ret.parent;
	}
	return ret;
}

Scope.prototype.toJSON = function(){
	var ret = {
		"define" : {},
		"children" : []
	};
	for(var name in this._defines){
		var variable = this._defines[name];
		ret["define"][variable.name] = variable.toJSON();
	}
	this.children.forEach(function(scope){
		ret["children"].push(scope.toJSON());
	})
	if( this._return ){
		ret["return"] = this._return.toJSON();
	}

	return ret;
}

//========================================
// for use-define chain
// Variable, Statement, Value has the same scope property
// -scope where the variable is defined
//========================================
var Variable = function(name, scope){

	this.id = Variable.generateID();

	this._chain = [];

	this.name = name || "";

	this.setScope(scope || null);
}

Variable.generateID = createIDGenerator();

Variable.prototype.setScope = function(scope){
	if(scope){
		this.scope = scope;
		this._chain.forEach(function(node){
			node.setScope(scope);
		})
	}
}

Variable.prototype.assign = function(rhs, loc){
	
	return this.assignProperty(null, rhs, loc);
}
// for object value
Variable.prototype.assignProperty = function(accessPath, rhs, loc){

	var node = new AssignStatement(accessPath, rhs, this.scope);

	this.addNode(node, loc);
	return node;
}
// use the variable or property, mainly for the single function call expression
// like module.init();
Variable.prototype.use = function(expression, loc){
	var node = new UseStatement(expression, this.scope);
	this.addNode(node, loc);
	return node;
}
Variable.prototype.addNode = function(node, loc){
	if( isUndefined(loc) ){
		loc = 999999999;
	}
	node.loc = loc;
	if( this.scope){
		node.setScope(this.scope);
	}

	this._chain.splice( this.inferenceIndex(loc)+1, 0, node);
	
	node.host = this;
	if( node.value ){
		// reattach value
		node.attachValue( node.value );
	}
}

Variable.prototype.clear = function(){
	this._chain = [];
}
// get a snapshot of the variable at a particular position
Variable.prototype.inference = function(loc /*optional*/, accessPath /*optional*/){
	if( isArray(loc) ){
		accessPath = loc;
		loc = undefined;
	}

	var possibleBranch = null;
	this._chain.forEach(function(node){
		if( possibleBranch){
			return;
		}
		if( node instanceof AssignStatement &&
			node.conditionalStatement ){
			possibleBranch = node.conditionalStatement.inBranch( loc );
		}
	})
	var chain = this._chain.filter(function(node){
		if( node instanceof UseStatement ){
			return false;
		}else if(node.conditionalStatement){
			if( possibleBranch ){
				return node.conditionalStatement.test() && 
					node.conditionalStatement == possibleBranch;
			}else{
				return node.conditionalStatement.test()
			}
		}else{
			return true;
		}
	})

	var idx = this.inferenceIndex(loc, chain);

	// merge the update of property if the node value is an object
	
	var res = Variable.merge( chain.slice(0, idx+1) );
	
	res && (res.targetVariable = this);
	
	if(accessPath && accessPath.length && res ){
		// the variable reference to the value
		return res.access(accessPath);
	}else{
		return res;
	}
}
Variable.prototype.atLoc = function(loc /*optional*/){
	var idx = this.inferenceIndex( loc );

	return this._chain[ idx ];
}
Variable.prototype.at = function(idx){
	return this._chain[idx];
}
Variable.prototype.inferenceIndex = function(loc, filteredChain /*optional*/){
	filteredChain = filteredChain || this._chain;
	// -1 is undefined
	if( ! loc && (loc !=0) ){
		return filteredChain.length-1
	}
	else{
		for(var i = 0; i < filteredChain.length; i++){
			if( loc < filteredChain[i].loc){
				return i-1;
			}
		}
		return filteredChain.length-1;
	}
}
Variable.prototype.derivation = function( getWorkListFilter ){

	var scope = this.scope;
	
	this._chain.forEach(function(node){
		node.derivation( getWorkListFilter );
	}, this);
}

Variable.prototype.toJSON = function(){
	var ret = []
	this._chain.forEach(function(node){

		ret.push(node.toJSON());
	})
	return ret;
}

Variable.prototype.asLibrary = function(){
	asLibrary( this );
}
// ------
// static method

// create anoymous variable from object expression or function expression
Variable.createAnoymous = function( expr ){
	var value = new Value(expr, expr.scope);
	var node = new AssignStatement(null);
	node.attachValue(value);
	var variable = new Variable("__anoymous__", expr.scope);
	// because anoymous variable(like lambda) always executed immediately
	// so we assume the location is 0(at the top of scope);
	variable.addNode(node, 0);
	return variable;
}

// merge a series of statements to one final value
Variable.merge = function(nodes){
	var	ret = null;
	nodes.forEach(function(node, idx){
		if( ! node.accessPath ){// reaching definition
			var value = node.value;
			// create a new value with derived ast
			ret = new Snapshot( value );
		}else{	//assign an property
			if(ret){
				var value = node.value;
				var ss = new Snapshot( value );
				ret.access( node.accessPath, ss );
			}else{

			}
		}
	})

	return ret;
}

//---------------------------------------------------
// modified object is like a branch of svn or git
var Modified = function(name, definedScope, useScope){
	// @read-only
	this.id = Modified.generateID();

	this._chain = [];
	this.name = name || "";
	
	this.setScope(useScope || null);

	this.definedScope = definedScope;
}
Modified.generateID = createIDGenerator();
// apply modify to the origin variable
// TODO
Modified.prototype.applyTo = function(variable, loc){
	this._chain.forEach(function(node){
		delete node.definedScope;
		variable.addNode( node, loc ); // copy the node ??
	})
}

extend(Modified.prototype, Variable.prototype);

//-------------------------------------------------
var AssignStatement = function(accessPath, rhs, scope){

	this.id = AssignStatement.generateID();

	this.accessPath = accessPath;
	this.setScope(scope || null);

	if( rhs ){
		this.attachValue( new Value(rhs, this.scope) );
	}
	this.loc = 0;

	// the value is assigend in a conditional statement
	// {ConditionalStatement}
	this.conditionalStatement = null;

	this.repetitiveStatement = null;
}
AssignStatement.generateID = createIDGenerator();

AssignStatement.prototype.setScope = function(scope){
	if( scope ){
		this.scope = scope;
		if(this.value){
			this.value.setScope(scope);
		}
	}
}
AssignStatement.prototype.attachValue = function(value, keepName /*optional*/){
	this.value = value;
	if( this.scope){
		this.value.setScope(this.scope);
	}
	// @read-only {AssignStatement}
	value.host = this;
	// @read-only {Variable}
	value.targetVariable = this.host;
	// @read-only
	keepName = isUndefined( keepName ) ? false : keepName;
	if( ! keepName ){
		if( this.accessPath ){
			this.accessPath = Value.prototype.solveAccessPath( this.accessPath );
			var last = this.accessPath[ this.accessPath.length-1 ];
			if( last.type == "Literal" ){
				var name = last.value;
			}
		}else{
			var name = this.host ? this.host.name :  "";
		}
		value.name = name;
	}

}
AssignStatement.prototype.derivation = function(getWorkListFilter){
	if( this.conditionalStatement ){
		this.conditionalStatement.derivation();
	}
	this.value.derivation(getWorkListFilter);
}

AssignStatement.prototype.applyDerivation = function(){
	this.value.applyDerivation();
}
AssignStatement.prototype.reduce = function(){
	this.value.reduce();
}
AssignStatement.prototype.clone = function(){
	var newNode = new AssignStatement(this.accessPath);
	extend(newNode, this);
	return newNode;
}
AssignStatement.prototype.toJSON = function(){
	var ret = {
		type : "assign",
		value : this.value.toJSON(),
		conditional : "",
		loc : this.loc
	}
	if(this.conditionalStatement){
		ret["conditional"] = this.conditionalStatement.getFlattenExpression();
	}
	if(this.accessPath){
		var tmp = [];
		this.accessPath.forEach(function(item){
			if(item.type == "Literal"){
				tmp.push(item.value);
			}else{
				tmp.push(gencode(item));
			}
		})
		ret["accessPath"] = tmp.join(".");
	}
	return ret;
}

//-----------------------------------------------------
var UseStatement = function(expression, scope){

	this.id = UseStatement.generateID();

	this.expression = expression;
	this.loc = 0;
	this.conditionalStatement = null;

	this.repetitiveStatement = null;

	this.setScope(scope || null);
}
UseStatement.generateID = createIDGenerator();
UseStatement.prototype.setScope = function(scope){
	if(scope){
		this.scope = scope;
	}
}

UseStatement.prototype.derivation = function(getWorkListFilter){
	// create a temp value in the variable's scope
	var value = new Value(this.expression, this.scope);
	value.host = this;
	value.derivation( getWorkListFilter );
	this.expression = value.getDerivedAst();
}
UseStatement.prototype.applyDerivation = function(){

}
UseStatement.prototype.reduce = function(){

	var value = new Value(this.expression, this.scope);
	value.host = this;
	value.reduce();
	this.expression = value.getDerivedAst();
}

UseStatement.prototype.clone = function(){
	var newNode = new UseStatement(this.accessPath);
	extend(newNode, this);
	return newNode;
}
UseStatement.prototype.toJSON = function(){
	var ret = {
		type : "use",
		expression : gencode( this.expression )
	}
}

//========================================
// Constructor for all value types
// include Object, Function, Expression, 
// 		Literal
//========================================
var Value = function(ast, scope){

	this.id = Value.generateID();

	this.setScope(scope || null);
	// parent is not null when value is an property of object
	this.parent = null;

	// value is for the basic type like number, string, function
	// it is a literal or function type ast
	this.value = null;

	// elements is for array
	this.elements = null;

	// if the value has other properties
	// the value will be force convert to an object type value 
	this.props = {
		'prototype' : null	// prototype is null or a value(or other object with a get method)
	}

	if(ast){
		this.update( ast );
		// origin ast, mainly for the derivation of expression;
		this.ast = ast;
	}

}
Value.generateID = createIDGenerator();

Value.prototype.setScope = function(scope){
	this.scope = scope;
	for(var name in this.props){
		var prop = this.props[name];
		if( prop && prop.setScope ){
			prop.setScope( scope );
		}
	}
}
Value.prototype.type = "undefined";
// parse expression recursively and construct correspond of value;
Value.prototype.update = function(ast){
	
	if( ! ast){
		return;
	}
	this.value = null;
	this.elements = null;

	switch(ast.type){
		// expression type
		case "BinaryExpression":
		case "LogicalExpression":
		case "UnaryExpression":
		case "UpdateExpression":
		case "CallExpression":
		case "Identifier":
		case "ThisExpression":
		case "NewExpression":
		case "MemberExpression":
		case "ConditionalExpression":
			this.type = "expression";
			this.expression = ast;
			extend(this, ExpressionValue.prototype);
			break;
		// object type
		case "ObjectExpression":
			this.type = "object";
			this.scopeSvForRebuild = ast.scope;	//save the scope for rebuild
			ast["properties"].forEach(function(item, idx){
				var propValue = new Value( item["value"], this.scope );
				// key is literal or identifier
				var keyName = item["key"]["name"] || item["key"]["value"];
				this.set( keyName, propValue);
			}, this);
			break;
		case "FunctionExpression":
		case "FunctionDeclaration":
			this.type = "function";
			this.value = ast;
			extend(this, FunctionValue.prototype);
			break;
		case "ArrayExpression":
			this.type = "array";
			this.elements = [];
			this.scopeSvForRebuild = ast.scope;
			ast["elements"].forEach(function(elem){
				this.elements.push( new Value(elem, this.scope) );
			}, this);
			break;
		case "Literal":
			this.type = "literal";
			this.value = ast;
			break;
		default:
			break;
	}
	// set buildin

}
// add a prefix to avoid confict with native property like toString
Value.prototype._prefix = "p_";
Value.prototype.withPrefix = withPrefix;
Value.prototype.withoutPrefix = withoutPrefix;
// get property from an object type value
// it will walk through the prototype chain
Value.prototype.get = function(key){
	if( this.type == "array" && isNumber(key) ){
		return this.elements[key];
	}

	var props = this.props;

	if(props[ this.withPrefix(key) ]){
		return props[ this.withPrefix(key) ];
	}
	// look up in the prototype chain
	else if(props["prototype"] && props["prototype"].get){
		return props["prototype"].get(key);
	}

}
// set property to an value
// if the value is a number, string or other based type
Value.prototype.set = function(key, val){
	if( this.type == "array" && isNumber(key) ){
		this.elements[key] = val;
	}else{
		this.props[ this.withPrefix(key) ] = val;
	}
	// @read-only
	val.name = key;
	// @read-only
	val.parent = this;

	return val;
}
// access an property of object by access path 
Value.prototype.access = function(accessPathArr, value /*optional*/){

	if( ! (accessPathArr && accessPathArr.length)){
		if( this.value){
			return this.value
		}else{
			return this;
		}
	}
	if(accessPathArr.constructor == String){
		accessPathArr = accessPathArr.split(".");
	}
	if( isObject(accessPathArr[0]) ){	//convert ast to code
		
		var res = this.solveAccessPath( accessPathArr );
		
		var solvedAll = true;
		res.forEach(function(item, idx){
			if(item.type == "Literal"){
				res[idx] = item.value;
			}else{
				solvedAll = false;
			}
		}, this)
		if( ! solvedAll){
			return ;
		}
		accessPathArr = res;
	}
	var deepestPropName = accessPathArr.pop();
	var prop = accessPathArr.reduce(function(prop, key){
		if( prop && prop.get ){
			if( key == "prototype" && ! prop.get("prototype") ){
				// give an empty prototype
				prop["prototype"] = new Value(TEMPLATE_OBJECT_EXPRESSION(), prop.scope);
			}
			if( prop.get(key) ){
				return prop.get(key);
			}
		}
	}, this);
	if( prop ){
		if( isUndefined(value) ){
			return prop.get(deepestPropName);	
		}else{
			return prop.set(deepestPropName, value);
		}
	}

};
// solve each item in access path
// do derivation and reduce
Value.prototype.solveAccessPath = function(accessPath){
	var ret = [];
	// accessPath derivation
	if(accessPath && accessPath.length ){

		accessPath.forEach(function(item, idx){
			// accessPath is solved already
			if( ! isObject(accessPath[0]) ){
				ret[idx] = item;
				return;
			}
			var val = new Value(item, item.scope);	//use the scope of expression
			val.derivation();
			val.reduce();
			//write back ast after derivation
			ret[idx] = val.getDerivedAst();
		}, this);
	}

	return ret;
}

Value.prototype.toJSON = function(){

	var properties = {},
		hasProperty = false;
	for( var name in this.props){
		var prop = this.props[name];
		if( prop ){
			hasProperty = true;
			properties[ this.withoutPrefix(name) ] = prop.toJSON();
		}
	}
	if( this.type == "object"){
		return properties;
	}
	else if(this.type == "array"){
		var elements = [];
		this.elements.forEach(function(value){
			elements.push(value.toJSON());
		})
		return withProperties("elements", elements);
	}
	else if(this.type == "expression"){
		return withProperties("expression", gencode( this.getDerivedAst() ) );
	}
	else if(this.value){
		return withProperties("value", gencode( this.value ) );
	}
	else{
		log('Unknown Type:'+this.ast.type, this.ast);
	}
	function withProperties(key, val){
		if( ! hasProperty){
			return val;
		}
		var ret = {
			properties : properties
		}
		ret[key] = val;
		return ret;
	}

}
// derivation is an operation to expand the identifier and function call
// node in the ast will be replaced when transfer the value;
//
// here getWorkListFilter param is for function scope derivation when the function is called
Value.prototype.derivation = function( getWorkListFilter ){

	if( this.type == "array"){
		this.elements.forEach(function(value){
			value.derivation( getWorkListFilter );
		})
	}

	for(var key in this.props){
		var prop = this.props[key];
		if( prop && prop.derivation ){
			prop.derivation( getWorkListFilter );
		}
	}
}
Value.prototype.applyDerivation = function(){

}
Value.prototype.getDerivedAst = function(){
	// because there is no ast format support the presentation both value and property
	// so we pefer to use the property of object type
	if( this.type == "object" ){
		return this.getPropertyDerivedAst();
	}
	else if(this.type == "expression"){
		return this.expression;
	}
	else if(this.type == "array"){
		var derivedAst = TEMPLATE_ARRAY_EXPRESSION();
		this.elements.forEach(function( value ){
			derivedAst["elements"].push( value.getDerivedAst() );
		})
		derivedAst.scope = this.scopeSvForRebuild;
		derivedAst.loc = deepCloneAst(this.ast.loc);
		return derivedAst;
	}
	else if(this.value){
		return this.value;
	}
	else{
		// this case ???
		return this.ast;
	}
}

Value.prototype.getPropertyDerivedAst = function(){
	var derivedAst = TEMPLATE_OBJECT_EXPRESSION();
	derivedAst.loc = deepCloneAst( this.ast.loc );
	for(var key in this.props){
		var prop = this.props[key];
		if(prop){
			var item = {
				"type" : "Property",
				"key" : TEMPLATE_LITERAL_EXPRESSION( this.withoutPrefix(key) ),
				"value" : prop.getDerivedAst(),
				"kind" : "init",	//other kinds?
				"loc" : prop.ast.loc //pending set loc to null?
			}
			derivedAst["properties"].push(item);
		}
	}
	derivedAst.scope = this.scopeSvForRebuild;
	return derivedAst;
}
Value.prototype.reduce = function(){
}
// traverse property
Value.prototype.eachProperty = function(callback){
	for(var name in this.props){
		var prop = this.props[name];
		if( prop ){
			callback && callback( prop, this.withoutPrefix(name) );
		}
	}
}
// pending, change the name when passing the value to an other variable ??
Value.prototype.getAccessPath = function(){
	var val = this;
	var path = val.name;
	while(val.parent){
		path = val.parent.name + "." + path;
		val = val.parent;
	}
	return path;
}
//------------------
// static method
Value.getDerivedAst = function( ast ){
	var derivedAst = deepCloneAst( ast );
	derivedAst = walk(derivedAst, function(node){
		// skip sub scope
		if( node.type == "FunctionDeclaration" ||
			node.type == "FunctionExpression"){
			return false;
		}
		return true;
		
	}, function(node){
		// this node is referenced by the origin node
		if( node.origin ){
			// convert FunctionDeclaration to FunctionExpression
			if(node.type == "FunctionDeclaration"){
				node.type = "FunctionExpression";
				node.id = null;
			}
		}
		return node;
	}, true);
	return derivedAst;
}

//----------------
// a snapshot of value
var Snapshot = function( value ){

	Value.call( this, value.getDerivedAst(), value.scope );
	this.name = value.name;

}

Snapshot.prototype = Value.prototype;

// -------------------------------
// value is an expression
// for example:
// val = a;
// val = 1+2;
// val = a+b;
// val = a.b;
// val = func();
var ExpressionValue = {};
ExpressionValue.prototype = {
	
	derivation : function( getWorkListFilter ){

		var me = this;
		walk(this.ast, function(node){
			if( node.type == "FunctionExpression" ||
				node.type == "ObjectExpression" ||
				node.type == "ArrayExpression" ||
				node.type == "MemberExpression" ||
				node.type == "FunctionDeclaration"){
				return false;
			}
			return true;
		}, function(node){
			switch(node.type){
				case "Identifier":
				case "ThisExpression":
					var res = me.identifierDerivation( node);
					break;
				case "CallExpression":
				case "NewExpression":
					// inference the return value from the call expression
					var res = me.callExpressionDerivation( node, getWorkListFilter );
					break;
				case "MemberExpression":
					var res = me.memberExpressionDerivation( node );
					break;
			}

			if( res ){
				node.reference = res;	//reference to a value;
			}

		}, isObjectOrFunctionOrLiteral );

		this.update( Value.getDerivedAst(this.ast) );
	},

	identifierDerivation : function(node){
		if( node.type == "ThisExpression"){
			name = "this";
		}
		var value = this.scope.inferenceValue(node, this.scope.offsetLoc(node.loc.start));
		if( value ){
			return value;
		}
	},
	// ----
	// -node
	// -scope where the function is called
	// -getWorkListFilter
	callExpressionDerivation : function(node, getWorkListFilter){

		var closureScope = node.scope;
		var callee = node["callee"];
		//find callee
		if( callee.reference && callee.reference.type == "function"){
			var func = callee.reference;
		}
		else if( callee.type == "FunctionExpression" ){	//anoymous function

			var variable = new Variable("__anoymous__", closureScope);
			var assignStat = variable.assign(callee, 0 );
			var func = assignStat.value;
		}else{
			var func = this.scope.inferenceValue(callee, this.scope.offsetLoc(node.loc.start) );
			
			if( ! func || func.type != "function"){
				return;
			}
		}
		var res = func.execute( node, this.scope, getWorkListFilter );
		if( ! res){
			return;
		}
		// transfer the possible returned value;
		var value = res.inference();

		if( value ){
			// transfer the ast
			return value;
		}else{
			// new expression return the constructed object(this) when has no return value
			if( node["type"] == "NewExpression" ){
				var res = func.ast.body.scope.getClosure("this");
				var value = res.inference();
				return value;
			}else{
				// log("Returned value is undefined");
				return;
			}
		}
	},

	memberExpressionDerivation : function( node ){
		
		var value = this.scope.inferenceValue( node, this.scope.offsetLoc(node.loc.start) );
		
		if( value ){
			return value
		}
	},

	// evaluate and reduce the expression;
	reduce : function(){
		
		var me = this;

		//use post order traverse
		walk(this.ast, function(node){
			return true;
		}, function(node){
			var ops = ExpressionValue._reduceOpMap[node.type];
			if( ops && ops.length ){
				var res;
				ops.forEach(function(op){
					var value = op.call(me, node);
					if( value ){
						res = value;
					}
				}, me);

				if( res && (res != node) ){
					node.reference = new Value(res, me.scope);
				}
			}
		}, true);

		this.update( Value.getDerivedAst(this.ast) );
	}
};

// static method
ExpressionValue._reduceOpMap = {};

ExpressionValue.registerReduceOperation = function(nodeType, func){
	if( ! ExpressionValue._reduceOpMap[nodeType] ){
		ExpressionValue._reduceOpMap[nodeType] = [];
	}
	ExpressionValue._reduceOpMap[nodeType].push( func );
}
ExpressionValue.removeReduceOperation = function(nodeType, func){
	var arr = ExpressionValue._reduceOpMap[nodeType];
	if( ! arr){
		return;
	}
	if( ! func){
		ExpressionValue._reduceOpMap[nodeType] = [];
	}else{
		var idx = arr.indexOf(func);
		arr.splice(idx, 1);
	}
}
// -----
// register some common reduce operation
var _register = ExpressionValue.registerReduceOperation;

_register("BinaryExpression", function(node){
	var left = Value.getDerivedAst(node.left),
		right = Value.getDerivedAst(node.right);

	if( ! (left.type == "Literal" && right.type == "Literal") ){
		return;
	}

	switch(node.operator){
		case "+":
			return TEMPLATE_LITERAL_EXPRESSION(left.value + right.value);
		case "-":
			return TEMPLATE_LITERAL_EXPRESSION(left.value - right.value);
		case "*":
			return TEMPLATE_LITERAL_EXPRESSION(left.value * right.value);
		case "/":
			return TEMPLATE_LITERAL_EXPRESSION(left.value / right.value);
		case "&":
			return TEMPLATE_LITERAL_EXPRESSION(left.value & right.value);
		case "|":
			return TEMPLATE_LITERAL_EXPRESSION(left.value | right.value);
		case "==":
			return TEMPLATE_LITERAL_EXPRESSION(left.value == right.value);
			//todo
		case "===":
			return TEMPLATE_LITERAL_EXPRESSION(left.value ===right.value);
			//todo
		case "!=":
			return TEMPLATE_LITERAL_EXPRESSION(left.value != right.value);
			//todo
		case "!==":
			return TEMPLATE_LITERAL_EXPRESSION(left.value !== right.value);
			//todo
	}
})
// todo
_register("UpdateExpression", function(node){

})
_register("ConditionalExpression", function(node){

})

_register("UnaryExpression", function(node){
	var arg = node.argument;
	if(arg.type == "Literal"){
		if( arg.operator == "-"){
			return TEMPLATE_LITERAL_EXPRESSION(0-left.value);
		}
		else if( arg.operator == "+"){
			return TEMPLATE_LITERAL_EXPRESSION(left.value);
		}
	}
})

_register("LogicalExpression", function(node){
	var left = Value.getDerivedAst(node.left),
		right = Value.getDerivedAst(node.right);

	switch(node.operator){
		case "&&":
			if( left.type == "Literal" ){
				// if left side op is true, move to right side op,
				// if left side op is false, return left side op directly
				return left.value ? right : left
			}
			return;
		case "||":
			// in contrast to && operator
			if( left.type == "Literal" ){
				return left.value ? left : right
			}
			else{
				var scope = this.scope,
					res = scope.inferenceVariable( left );
				if(res && res.variable){
					var value = res.variable.inference(scope.offsetLoc(left.loc.start), res.accessPath);
					if( ! value){
						// value of expr is undefined;
						// this case is mainly for the expr like
						// var Moduel = Module || {};
						return right;
					}else{
						return left;
					}
				}else{
					// we assume the unkown expr is existed in some library and the value is true
					return left;
				}
			}
	}

})
//----------------------------------------------------
// value is an array

// ---------------------------------------------------
// value is a function
var FunctionValue = {};
FunctionValue.prototype = {
	type : "function",

	_passedInVar : {},

	// arguments is an array of ast object
	setClosure : function(thisObj, _arguments, scope){
		var bodyScope = this.ast.body.scope;

		this._passedInVar = {};

		if( bodyScope ){
			var params = this.ast.params;

			bodyScope.setClosure("this", new Variable("this", bodyScope));
			if(thisObj){
				this._passedInVar["this"] = thisObj.targetVariable;

				var node = new AssignStatement(null, null);
				// this will set scope of all the properties to bodyScope
				// and it will be reset after the end of the execution
				// pending : may have problem here 
				bodyScope.getClosure("this").addNode(node, 0);
				node.attachValue(thisObj, true);
			}
			// prepare arguments passed into the function
			for( var i = 0; i < params.length; i++){
				var paramName = params[i].name;
				var variable = new Variable(paramName, bodyScope);

				var argExpr = _arguments[i];
				if( argExpr ){
					var value = scope.inferenceValue( argExpr, scope.offsetLoc( argExpr.loc.start) );
					if( value ){
						this._passedInVar[paramName] = value.targetVariable;

						var node = new AssignStatement(null, null);
						variable.addNode(node, 0);
						node.attachValue( value, true);
					}else{
						// some other expressions, like LiteralExpression
						// directly use the expr;
						var node = new AssignStatement(null, argExpr);
						variable.addNode(node, 0);
					}
				}
				bodyScope.setClosure( paramName, variable );
			}
		}
	},
	setCaller : function(caller, callloc){
		var bodyScope = this.ast.body.scope;
		bodyScope._caller = caller;
		bodyScope._callloc = callloc;
	},
	initializeContext : function( callExprAst, scope ){

		var bodyScope = this.ast.body.scope;
		if( callExprAst["type"] == "NewExpression" ){
			// create a new object value
			var thisObj = new Value(TEMPLATE_OBJECT_EXPRESSION(), scope);
		}else{
			// assume the func is called by its host object;
			var thisObj = this.parent || exports.windowObj;
		}
		bodyScope.clear();
		this.setClosure(thisObj, callExprAst["arguments"], scope);
	},
	// -scope the caller scope
	execute : function(callExprAst, scope, getWorkListFilter /*optional*/){
		if( ! this.ast.body){
			return;
		}

		if( this.isRecursive(scope) ){
			log("Warning: there is a recursive call", this.value);
			return;
		}

		this.initializeContext( callExprAst, scope );

		var bodyScope = this.ast.body.scope;

		this.setCaller(scope, scope.offsetLoc(callExprAst.loc.start));
		bodyScope.initialize();

		bodyScope.derivation( getWorkListFilter );

		FunctionValue.execAsBuildin( this );

		this.applyModify();

		var ret = bodyScope.getReturn();
		return ret;
	},

	// apply the modify of value changed in the function execution
	applyModify : function(){
		var bodyScope = this.ast.body.scope;
		for(var v_name in bodyScope._modified){
			var modified = bodyScope._modified[v_name];
			var definedScope = modified.definedScope;	//the scope where the modifed value is defined;
			var variable = definedScope.getDefine( modified.name );
			if( variable ){
				// function is in the caller scope
				// todo, there is some problem here
				if( bodyScope.inScope( definedScope ) ){
					modified.applyTo(variable, bodyScope._callloc);
				}
				else{
					// in this case (like use a closure to simulate a private property)
					// the function of definedScope has finished execution before the value in closure is modified by the call in the other scope;
					// so we add the assignStatememnt at the last of the scope;
					modified.applyTo(variable, definedScope.offsetLoc(definedScope.ast.loc.end));
				}
			}
		}

		// apply the modify of arguments and this object
		for(var name in this._passedInVar){
			var variable = this._passedInVar[name];
			if( ! variable ){
				continue;
			}
			else if( ! variable.scope){
				log("todo: fix this "+variable.name, variable.inference().ast);
				continue;
			}
			var definedScope = variable.scope;

			if( bodyScope.inScope( definedScope ) ){
				var loc = bodyScope._callloc;
			}
			else{
				var loc = definedScope.offsetLoc(definedScope.ast.loc.end);
			}
			// apply the modify of the property
			var closureVariable = bodyScope.getClosure( name );
			// ignore the assignment when passed in the params and this object
			// so here is from the second assignment statement
			for(var i = 1; i < closureVariable._chain.length; i++){
				var node = closureVariable._chain[i];
				if( node.accessPath ){
					variable.addNode( node, loc );
				}else{
					break;
				}
			}
		}
	},
	// find possible recursive call
	isRecursive : function( caller ){

		var callee = this.ast.body.scope;

		caller = caller || callee._caller;

		while( caller ){
			if( caller == callee){
				return true;
			}
			caller = caller._caller;
		}
		return false;
	}
}
FunctionValue.asBuildin = function(accessPath, exec){
	_buildins[ accessPath ] = exec;
}
FunctionValue.execAsBuildin = function( value ){
	var buildin = _buildins[ value.getAccessPath() ];
	if( buildin ){
		buildin.call( value );
	}
}
var _buildins = {}

//============================================
// Statement 
// If Statement WhileStatement
//============================================
var ConditionalStatement = function(parent){

	this._expressions = [];

	if( parent ){
		this.parent = parent;
		parent.children.push( this );
	}

	this.alternate = null;

	this.children = [];

	this.start = this.end = 0;
}

ConditionalStatement.prototype.inBranch = function( loc ){
	if( ! loc ){
		return;
	}
	var ret = null;
	if( loc < this.end && loc > this.start){
		ret = this;
	}
	// find the deepest branch
	this.children.forEach(function( branch ){
		var ret2 = branch.inBranch( loc );
		if( ret2 ){
			ret = ret2;
		}
	})
	return ret;
}

ConditionalStatement.prototype.or = function( expression ){

	this._expressions.push( expression );
}

ConditionalStatement.prototype.derivation = function(){

	this._expressions.forEach(function( expr, idx ){
		var value = new Value( expr, expr.scope );
		value.derivation();
		value.reduce();
		expr = value.getDerivedAst();
		this._expressions[ idx ] = expr;
	}, this)

	this.parent && this.parent.derivation();
}

ConditionalStatement.prototype.test = function(){
	var res = false;
	this._expressions.forEach(function( expr, idx ){
		if( expr.type == "Literal"){
			res = expr.value ? true : false;
		}
		else{	//suppose it is true
			res = true;
		}
	}, this)
	if( this.parent ){
		res = this.parent.test() && res;
	}
	if( ! res && this.alternate ){
		// switch to alternate branch
		this.alternate.test = function(){
			return true;
		}
	}
	return res;
}

ConditionalStatement.prototype.getFlattenExpression = function(){
	var code = "0";
	this._expressions.forEach(function(expr){
		code += " || "+ gencode(expr);
	})
	if( this.parent ){
		code += " && " + this.parent.getFlattenExpression();
	}
	return code;
}

//=============================================
// Build a scope tree from given ast
//=============================================
function buildScope(ast, globalScope){

	var globalScope = globalScope || new Scope;
	var currentScope = globalScope;

	walk(ast, function(node){

		node.scope = currentScope;
		switch(node.type){
			case "FunctionDeclaration":
				var name = node["id"]["name"];
				currentScope.define(name);
			case "FunctionExpression":
				var scope = new Scope(currentScope);
				currentScope = scope;
				scope.ast = node.body;
				return true;
			case "VariableDeclarator":
				var name = node["id"]["name"];
				currentScope.define(name);
				break;
			case "MemberExpression":
				// pre-processing the member expression
				// object.property -> object["property"]
				if( ! node.computed){
					node.computed = true;
					var name = node["property"]["name"];
					var computedProp = TEMPLATE_LITERAL_EXPRESSION(name);
					computedProp.loc = node["property"]["loc"];
					node["property"] = computedProp;
				}
		}

		return true;

	}, function(node){

		if( node.type ==  "FunctionDeclaration" || 
			node.type == "FunctionExpression"){
			currentScope = currentScope.parent;
		}
	});
	ast.scope = globalScope;
	globalScope.ast = ast;

	return globalScope;
}

//=========================================
// some util methods, from underscore.js
//=========================================
function isFunction(obj){
	return toString.call(obj) == "[object Function]";
}
function isString(obj){
	return toString.call(obj) == "[object String]";
}
function isNumber(obj){
	return toString.call(obj) == "[object Number]";
}
function isObject(obj){
	return obj === Object(obj);
}
function isArray(obj){
	return Array.isArray(obj);
}
function isUndefined(obj){
	return obj === void 0;
}
function extend(obj){
	Array.prototype.slice.call(arguments, 1).forEach(function(source) {
    	for (var prop in source) {
			obj[prop] = source[prop];
    	}
	});
	return obj;
}

function gencode(ast){
	return codegen.generate( ast );
}

var _logcache = [];

function log(msg, expression){
	if( ! exports.enableLog ){
		return;
	}
	if( expression && isObject(expression) ){
		if( expression.loc){
			msg = expression.loc.start.line +","+expression.loc.start.column+":\t\t"+msg;
		}
		msg += ",  EXPR:"+ gencode( expression );
	}
	if(arguments[arguments.length-1] == true){
		console.log(msg);
	}

	_logcache.push( msg );
}

function flushlog(filename, callback){
	var str = _logcache.join('\n');
	var filename = filename || "log.txt";
	if( isFunction(filename) ){
		callback = filename;
		filename = "log.txt";
	}
	fs.writeFile(filename, str, function(err){
		callback && callback();
	})
	_logcache = [];
}

function withPrefix(propName){
	return this._prefix + propName;
}
function withoutPrefix(propName){
	if( propName.indexOf( this._prefix) == 0 ){
		return propName.replace(this._prefix, "");
	}
}
function createIDGenerator(baseID){

	var id = baseID || 0;

	return function(){
		return (id++);
	}
}
function isObjectOrFunctionOrLiteral( node ){
	if( ! node.reference ){
		return false;
	}
	var type = getReference(node).type;
	return type == "function" ||
			type == "object" ||
			type == "Literal";
}
function getReference(node){

	var ref = node.reference,
		footprint = [node];
	while(ref.ast.reference){
		// check circular reference
		if( footprint.indexOf(ref.ast) >= 0){
			log("Circular Reference Direct", ref.ast);
			break;
		}
		footprint.push(ref.ast);
		ref = ref.ast.reference;
	}
	return ref;
}
// use a variable as library
function asLibrary(variable){
	var node = new AssignStatement();
	node.attachValue( variable.inference() );
	var newVar = new Variable(variable.name, variable.scope);
	newVar.addNode(node, -1);	//libaray use a negative location
	newVar.scope.setDefine(variable.name, variable);
	return newVar;
}

//=========================================
// exports method
//=========================================
exports.walk 			= walk;
exports.buildScope 		= buildScope;
exports.Scope 			= Scope;
exports.Variable 		= Variable;
exports.AssignStatement = AssignStatement;
exports.UseStatement 	= UseStatement;
exports.Value 			= Value;
exports.Snapshot 		= Snapshot;
exports.ExpressionValue = ExpressionValue;
exports.FunctionValue	= FunctionValue;
exports.log 			= log;
exports.flushlog		= flushlog;
exports.enableLog		= true;
exports.asLibrary		= asLibrary;

exports.getDefaultWorklistFilter = function(scope){
	return exports.defaultWorklistFilter;
}
exports.defaultWorklistFilter = function(derivableItem){
	derivableItem.reduce();
	derivableItem.derivation( exports.getDefaultWorklistFilter );
	return true;
}

//
var globalScope = new Scope();
var windowVariable = globalScope.define("window");
var windowAst = TEMPLATE_OBJECT_EXPRESSION();
windowAst.scope = globalScope;
windowVariable.assign(windowAst, 0);

exports.windowObj	= windowVariable.inference();
exports.globalScope = globalScope;