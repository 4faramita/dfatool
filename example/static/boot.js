/**
 * boot the web app
 * exposed config 	LIB_PATH,
					CORE_PATH
 * global value		G		
 */
(function(){	
	//=========================
	// CONFIG
	//=========================

	this["LIB_PATH"] 	= "lib-debug/";

	this["CORE_PATH"]	= "core/";

	$LAB.setGlobalDefaults({BasePath:LIB_PATH});
	//=========================
	// Load Library
	//=========================
	$LAB.script("less.js")
		.script("require.js")
		.script("jquery.js")
		.script("flexie.js")
		.script("director.js")

	//=========================
	// global value exposed to the window
	//=========================
	this["G"] = {
		"route" : "",		//current root
		"$app"	: null		//app container
	}
	//========================
	// Load Core
	//========================
	$LAB.setOptions({BasePath : CORE_PATH})
		.script("core.js")
		.wait(boot);

	//========================
	// Load Main Module
	//========================
	function boot(){

		config();

		require(["modules/main/index",
				"hub",
				"knockout",
				"mustache"], function( Main, hub, ko, mustache ){

			hub.subscribe("module:loaded", function(name){
				console.log("loaded, "+name);
			})

			configKO( ko );

			G["$app"] = $("#App");
			Main.load( G["$app"] );
		});
	}


	function config(){
		// require.js
		requirejs.config({
			paths : {
				knockout 	: LIB_PATH + "knockout",
				mustache 	: LIB_PATH + "mustache",
				async		: LIB_PATH + "async",
				hub			: "modules/hub",
				"ko.mapping": LIB_PATH + "ko.mapping",
				esprima		: LIB_PATH + "esprima",
				escodegen 	: LIB_PATH + "escodegen",
				dfatool		: LIB_PATH + "dfatool"
			}
		})
	}

	// https://github.com/WTK/ko.mustache.js/blob/master/ko.mustache.js
	function configKO( ko ){

		ko.mustacheTemplateEngine = function () { }

		ko.mustacheTemplateEngine.prototype = ko.utils.extend(new ko.templateEngine(), {

			renderTemplateSource: function (templateSource, bindingContext, options) {
				var data = bindingContext.$data;
				var templateText = templateSource.text();		
				var htmlResult = Mustache.to_html(templateText, data);

				return ko.utils.parseHtmlFragment(htmlResult);
			},

			allowTemplateRewriting: false,

			version: '0.9.0'

		});
	}

	this["configKO"] = configKO;
}).call( this )
