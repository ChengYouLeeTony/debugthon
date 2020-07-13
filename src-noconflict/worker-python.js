"no use strict";
!(function(window) {
if (typeof window.window != "undefined" && window.document)
    return;
if (window.require && window.define)
    return;

if (!window.console) {
    window.console = function() {
        var msgs = Array.prototype.slice.call(arguments, 0);
        postMessage({type: "log", data: msgs});
    };
    window.console.error =
    window.console.warn = 
    window.console.log =
    window.console.trace = window.console;
}
window.window = window;
window.ace = window;

window.onerror = function(message, file, line, col, err) {
    postMessage({type: "error", data: {
        message: message,
        data: err.data,
        file: file,
        line: line, 
        col: col,
        stack: err.stack
    }});
};

window.normalizeModule = function(parentId, moduleName) {
    // normalize plugin requires
    if (moduleName.indexOf("!") !== -1) {
        var chunks = moduleName.split("!");
        return window.normalizeModule(parentId, chunks[0]) + "!" + window.normalizeModule(parentId, chunks[1]);
    }
    // normalize relative requires
    if (moduleName.charAt(0) == ".") {
        var base = parentId.split("/").slice(0, -1).join("/");
        moduleName = (base ? base + "/" : "") + moduleName;
        
        while (moduleName.indexOf(".") !== -1 && previous != moduleName) {
            var previous = moduleName;
            moduleName = moduleName.replace(/^\.\//, "").replace(/\/\.\//, "/").replace(/[^\/]+\/\.\.\//, "");
        }
    }
    
    return moduleName;
};

window.require = function require(parentId, id) {
    if (!id) {
        id = parentId;
        parentId = null;
    }
    if (!id.charAt)
        throw new Error("worker.js require() accepts only (parentId, id) as arguments");

    id = window.normalizeModule(parentId, id);

    var module = window.require.modules[id];
    if (module) {
        if (!module.initialized) {
            module.initialized = true;
            module.exports = module.factory().exports;
        }
        return module.exports;
    }
   
    if (!window.require.tlns)
        return console.log("unable to load " + id);
    
    var path = resolveModuleId(id, window.require.tlns);
    if (path.slice(-3) != ".js") path += ".js";
    
    window.require.id = id;
    window.require.modules[id] = {}; // prevent infinite loop on broken modules
    importScripts(path);
    return window.require(parentId, id);
};
function resolveModuleId(id, paths) {
    var testPath = id, tail = "";
    while (testPath) {
        var alias = paths[testPath];
        if (typeof alias == "string") {
            return alias + tail;
        } else if (alias) {
            return  alias.location.replace(/\/*$/, "/") + (tail || alias.main || alias.name);
        } else if (alias === false) {
            return "";
        }
        var i = testPath.lastIndexOf("/");
        if (i === -1) break;
        tail = testPath.substr(i) + tail;
        testPath = testPath.slice(0, i);
    }
    return id;
}
window.require.modules = {};
window.require.tlns = {};

window.define = function(id, deps, factory) {
    if (arguments.length == 2) {
        factory = deps;
        if (typeof id != "string") {
            deps = id;
            id = window.require.id;
        }
    } else if (arguments.length == 1) {
        factory = id;
        deps = [];
        id = window.require.id;
    }
    
    if (typeof factory != "function") {
        window.require.modules[id] = {
            exports: factory,
            initialized: true
        };
        return;
    }

    if (!deps.length)
        // If there is no dependencies, we inject "require", "exports" and
        // "module" as dependencies, to provide CommonJS compatibility.
        deps = ["require", "exports", "module"];

    var req = function(childId) {
        return window.require(id, childId);
    };

    window.require.modules[id] = {
        exports: {},
        factory: function() {
            var module = this;
            var returnExports = factory.apply(this, deps.slice(0, factory.length).map(function(dep) {
                switch (dep) {
                    // Because "require", "exports" and "module" aren't actual
                    // dependencies, we must handle them seperately.
                    case "require": return req;
                    case "exports": return module.exports;
                    case "module":  return module;
                    // But for all other dependencies, we can just go ahead and
                    // require them.
                    default:        return req(dep);
                }
            }));
            if (returnExports)
                module.exports = returnExports;
            return module;
        }
    };
};
window.define.amd = {};
require.tlns = {};
window.initBaseUrls  = function initBaseUrls(topLevelNamespaces) {
    for (var i in topLevelNamespaces)
        require.tlns[i] = topLevelNamespaces[i];
};

window.initSender = function initSender() {

    var EventEmitter = window.require("ace/lib/event_emitter").EventEmitter;
    var oop = window.require("ace/lib/oop");
    
    var Sender = function() {};
    
    (function() {
        
        oop.implement(this, EventEmitter);
                
        this.callback = function(data, callbackId) {
            postMessage({
                type: "call",
                id: callbackId,
                data: data
            });
        };
    
        this.emit = function(name, data) {
            postMessage({
                type: "event",
                name: name,
                data: data
            });
        };
        
    }).call(Sender.prototype);
    
    return new Sender();
};

var main = window.main = null;
var sender = window.sender = null;

window.onmessage = function(e) {
    var msg = e.data;
    if (msg.event && sender) {
        sender._signal(msg.event, msg.data);
    }
    else if (msg.command) {
        if (main[msg.command])
            main[msg.command].apply(main, msg.args);
        else if (window[msg.command])
            window[msg.command].apply(window, msg.args);
        else
            throw new Error("Unknown command:" + msg.command);
    }
    else if (msg.init) {
        window.initBaseUrls(msg.tlns);
        require("ace/lib/es5-shim");
        sender = window.sender = window.initSender();
        var clazz = require(msg.module)[msg.classname];
        main = window.main = new clazz(sender);
    }
};
})(this);

ace.define("ace/lib/oop",[], function(require, exports, module) {
"use strict";

exports.inherits = function(ctor, superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });
};

exports.mixin = function(obj, mixin) {
    for (var key in mixin) {
        obj[key] = mixin[key];
    }
    return obj;
};

exports.implement = function(proto, mixin) {
    exports.mixin(proto, mixin);
};

});

ace.define("ace/range",[], function(require, exports, module) {
"use strict";
var comparePoints = function(p1, p2) {
    return p1.row - p2.row || p1.column - p2.column;
};
var Range = function(startRow, startColumn, endRow, endColumn) {
    this.start = {
        row: startRow,
        column: startColumn
    };

    this.end = {
        row: endRow,
        column: endColumn
    };
};

(function() {
    this.isEqual = function(range) {
        return this.start.row === range.start.row &&
            this.end.row === range.end.row &&
            this.start.column === range.start.column &&
            this.end.column === range.end.column;
    };
    this.toString = function() {
        return ("Range: [" + this.start.row + "/" + this.start.column +
            "] -> [" + this.end.row + "/" + this.end.column + "]");
    };

    this.contains = function(row, column) {
        return this.compare(row, column) == 0;
    };
    this.compareRange = function(range) {
        var cmp,
            end = range.end,
            start = range.start;

        cmp = this.compare(end.row, end.column);
        if (cmp == 1) {
            cmp = this.compare(start.row, start.column);
            if (cmp == 1) {
                return 2;
            } else if (cmp == 0) {
                return 1;
            } else {
                return 0;
            }
        } else if (cmp == -1) {
            return -2;
        } else {
            cmp = this.compare(start.row, start.column);
            if (cmp == -1) {
                return -1;
            } else if (cmp == 1) {
                return 42;
            } else {
                return 0;
            }
        }
    };
    this.comparePoint = function(p) {
        return this.compare(p.row, p.column);
    };
    this.containsRange = function(range) {
        return this.comparePoint(range.start) == 0 && this.comparePoint(range.end) == 0;
    };
    this.intersects = function(range) {
        var cmp = this.compareRange(range);
        return (cmp == -1 || cmp == 0 || cmp == 1);
    };
    this.isEnd = function(row, column) {
        return this.end.row == row && this.end.column == column;
    };
    this.isStart = function(row, column) {
        return this.start.row == row && this.start.column == column;
    };
    this.setStart = function(row, column) {
        if (typeof row == "object") {
            this.start.column = row.column;
            this.start.row = row.row;
        } else {
            this.start.row = row;
            this.start.column = column;
        }
    };
    this.setEnd = function(row, column) {
        if (typeof row == "object") {
            this.end.column = row.column;
            this.end.row = row.row;
        } else {
            this.end.row = row;
            this.end.column = column;
        }
    };
    this.inside = function(row, column) {
        if (this.compare(row, column) == 0) {
            if (this.isEnd(row, column) || this.isStart(row, column)) {
                return false;
            } else {
                return true;
            }
        }
        return false;
    };
    this.insideStart = function(row, column) {
        if (this.compare(row, column) == 0) {
            if (this.isEnd(row, column)) {
                return false;
            } else {
                return true;
            }
        }
        return false;
    };
    this.insideEnd = function(row, column) {
        if (this.compare(row, column) == 0) {
            if (this.isStart(row, column)) {
                return false;
            } else {
                return true;
            }
        }
        return false;
    };
    this.compare = function(row, column) {
        if (!this.isMultiLine()) {
            if (row === this.start.row) {
                return column < this.start.column ? -1 : (column > this.end.column ? 1 : 0);
            }
        }

        if (row < this.start.row)
            return -1;

        if (row > this.end.row)
            return 1;

        if (this.start.row === row)
            return column >= this.start.column ? 0 : -1;

        if (this.end.row === row)
            return column <= this.end.column ? 0 : 1;

        return 0;
    };
    this.compareStart = function(row, column) {
        if (this.start.row == row && this.start.column == column) {
            return -1;
        } else {
            return this.compare(row, column);
        }
    };
    this.compareEnd = function(row, column) {
        if (this.end.row == row && this.end.column == column) {
            return 1;
        } else {
            return this.compare(row, column);
        }
    };
    this.compareInside = function(row, column) {
        if (this.end.row == row && this.end.column == column) {
            return 1;
        } else if (this.start.row == row && this.start.column == column) {
            return -1;
        } else {
            return this.compare(row, column);
        }
    };
    this.clipRows = function(firstRow, lastRow) {
        if (this.end.row > lastRow)
            var end = {row: lastRow + 1, column: 0};
        else if (this.end.row < firstRow)
            var end = {row: firstRow, column: 0};

        if (this.start.row > lastRow)
            var start = {row: lastRow + 1, column: 0};
        else if (this.start.row < firstRow)
            var start = {row: firstRow, column: 0};

        return Range.fromPoints(start || this.start, end || this.end);
    };
    this.extend = function(row, column) {
        var cmp = this.compare(row, column);

        if (cmp == 0)
            return this;
        else if (cmp == -1)
            var start = {row: row, column: column};
        else
            var end = {row: row, column: column};

        return Range.fromPoints(start || this.start, end || this.end);
    };

    this.isEmpty = function() {
        return (this.start.row === this.end.row && this.start.column === this.end.column);
    };
    this.isMultiLine = function() {
        return (this.start.row !== this.end.row);
    };
    this.clone = function() {
        return Range.fromPoints(this.start, this.end);
    };
    this.collapseRows = function() {
        if (this.end.column == 0)
            return new Range(this.start.row, 0, Math.max(this.start.row, this.end.row-1), 0);
        else
            return new Range(this.start.row, 0, this.end.row, 0);
    };
    this.toScreenRange = function(session) {
        var screenPosStart = session.documentToScreenPosition(this.start);
        var screenPosEnd = session.documentToScreenPosition(this.end);

        return new Range(
            screenPosStart.row, screenPosStart.column,
            screenPosEnd.row, screenPosEnd.column
        );
    };
    this.moveBy = function(row, column) {
        this.start.row += row;
        this.start.column += column;
        this.end.row += row;
        this.end.column += column;
    };

}).call(Range.prototype);
Range.fromPoints = function(start, end) {
    return new Range(start.row, start.column, end.row, end.column);
};
Range.comparePoints = comparePoints;

Range.comparePoints = function(p1, p2) {
    return p1.row - p2.row || p1.column - p2.column;
};


exports.Range = Range;
});

ace.define("ace/apply_delta",[], function(require, exports, module) {
"use strict";

function throwDeltaError(delta, errorText){
    console.log("Invalid Delta:", delta);
    throw "Invalid Delta: " + errorText;
}

function positionInDocument(docLines, position) {
    return position.row    >= 0 && position.row    <  docLines.length &&
           position.column >= 0 && position.column <= docLines[position.row].length;
}

function validateDelta(docLines, delta) {
    if (delta.action != "insert" && delta.action != "remove")
        throwDeltaError(delta, "delta.action must be 'insert' or 'remove'");
    if (!(delta.lines instanceof Array))
        throwDeltaError(delta, "delta.lines must be an Array");
    if (!delta.start || !delta.end)
       throwDeltaError(delta, "delta.start/end must be an present");
    var start = delta.start;
    if (!positionInDocument(docLines, delta.start))
        throwDeltaError(delta, "delta.start must be contained in document");
    var end = delta.end;
    if (delta.action == "remove" && !positionInDocument(docLines, end))
        throwDeltaError(delta, "delta.end must contained in document for 'remove' actions");
    var numRangeRows = end.row - start.row;
    var numRangeLastLineChars = (end.column - (numRangeRows == 0 ? start.column : 0));
    if (numRangeRows != delta.lines.length - 1 || delta.lines[numRangeRows].length != numRangeLastLineChars)
        throwDeltaError(delta, "delta.range must match delta lines");
}

exports.applyDelta = function(docLines, delta, doNotValidate) {
    
    var row = delta.start.row;
    var startColumn = delta.start.column;
    var line = docLines[row] || "";
    switch (delta.action) {
        case "insert":
            var lines = delta.lines;
            if (lines.length === 1) {
                docLines[row] = line.substring(0, startColumn) + delta.lines[0] + line.substring(startColumn);
            } else {
                var args = [row, 1].concat(delta.lines);
                docLines.splice.apply(docLines, args);
                docLines[row] = line.substring(0, startColumn) + docLines[row];
                docLines[row + delta.lines.length - 1] += line.substring(startColumn);
            }
            break;
        case "remove":
            var endColumn = delta.end.column;
            var endRow = delta.end.row;
            if (row === endRow) {
                docLines[row] = line.substring(0, startColumn) + line.substring(endColumn);
            } else {
                docLines.splice(
                    row, endRow - row + 1,
                    line.substring(0, startColumn) + docLines[endRow].substring(endColumn)
                );
            }
            break;
    }
};
});

ace.define("ace/lib/event_emitter",[], function(require, exports, module) {
"use strict";

var EventEmitter = {};
var stopPropagation = function() { this.propagationStopped = true; };
var preventDefault = function() { this.defaultPrevented = true; };

EventEmitter._emit =
EventEmitter._dispatchEvent = function(eventName, e) {
    this._eventRegistry || (this._eventRegistry = {});
    this._defaultHandlers || (this._defaultHandlers = {});

    var listeners = this._eventRegistry[eventName] || [];
    var defaultHandler = this._defaultHandlers[eventName];
    if (!listeners.length && !defaultHandler)
        return;

    if (typeof e != "object" || !e)
        e = {};

    if (!e.type)
        e.type = eventName;
    if (!e.stopPropagation)
        e.stopPropagation = stopPropagation;
    if (!e.preventDefault)
        e.preventDefault = preventDefault;

    listeners = listeners.slice();
    for (var i=0; i<listeners.length; i++) {
        listeners[i](e, this);
        if (e.propagationStopped)
            break;
    }
    
    if (defaultHandler && !e.defaultPrevented)
        return defaultHandler(e, this);
};


EventEmitter._signal = function(eventName, e) {
    var listeners = (this._eventRegistry || {})[eventName];
    if (!listeners)
        return;
    listeners = listeners.slice();
    for (var i=0; i<listeners.length; i++)
        listeners[i](e, this);
};

EventEmitter.once = function(eventName, callback) {
    var _self = this;
    this.addEventListener(eventName, function newCallback() {
        _self.removeEventListener(eventName, newCallback);
        callback.apply(null, arguments);
    });
    if (!callback) {
        return new Promise(function(resolve) {
            callback = resolve;
        });
    }
};


EventEmitter.setDefaultHandler = function(eventName, callback) {
    var handlers = this._defaultHandlers;
    if (!handlers)
        handlers = this._defaultHandlers = {_disabled_: {}};
    
    if (handlers[eventName]) {
        var old = handlers[eventName];
        var disabled = handlers._disabled_[eventName];
        if (!disabled)
            handlers._disabled_[eventName] = disabled = [];
        disabled.push(old);
        var i = disabled.indexOf(callback);
        if (i != -1) 
            disabled.splice(i, 1);
    }
    handlers[eventName] = callback;
};
EventEmitter.removeDefaultHandler = function(eventName, callback) {
    var handlers = this._defaultHandlers;
    if (!handlers)
        return;
    var disabled = handlers._disabled_[eventName];
    
    if (handlers[eventName] == callback) {
        if (disabled)
            this.setDefaultHandler(eventName, disabled.pop());
    } else if (disabled) {
        var i = disabled.indexOf(callback);
        if (i != -1)
            disabled.splice(i, 1);
    }
};

EventEmitter.on =
EventEmitter.addEventListener = function(eventName, callback, capturing) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners)
        listeners = this._eventRegistry[eventName] = [];

    if (listeners.indexOf(callback) == -1)
        listeners[capturing ? "unshift" : "push"](callback);
    return callback;
};

EventEmitter.off =
EventEmitter.removeListener =
EventEmitter.removeEventListener = function(eventName, callback) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners)
        return;

    var index = listeners.indexOf(callback);
    if (index !== -1)
        listeners.splice(index, 1);
};

EventEmitter.removeAllListeners = function(eventName) {
    if (this._eventRegistry) this._eventRegistry[eventName] = [];
};

exports.EventEmitter = EventEmitter;

});

ace.define("ace/anchor",[], function(require, exports, module) {
"use strict";

var oop = require("./lib/oop");
var EventEmitter = require("./lib/event_emitter").EventEmitter;

var Anchor = exports.Anchor = function(doc, row, column) {
    this.$onChange = this.onChange.bind(this);
    this.attach(doc);
    
    if (typeof column == "undefined")
        this.setPosition(row.row, row.column);
    else
        this.setPosition(row, column);
};

(function() {

    oop.implement(this, EventEmitter);
    this.getPosition = function() {
        return this.$clipPositionToDocument(this.row, this.column);
    };
    this.getDocument = function() {
        return this.document;
    };
    this.$insertRight = false;
    this.onChange = function(delta) {
        if (delta.start.row == delta.end.row && delta.start.row != this.row)
            return;

        if (delta.start.row > this.row)
            return;
            
        var point = $getTransformedPoint(delta, {row: this.row, column: this.column}, this.$insertRight);
        this.setPosition(point.row, point.column, true);
    };
    
    function $pointsInOrder(point1, point2, equalPointsInOrder) {
        var bColIsAfter = equalPointsInOrder ? point1.column <= point2.column : point1.column < point2.column;
        return (point1.row < point2.row) || (point1.row == point2.row && bColIsAfter);
    }
            
    function $getTransformedPoint(delta, point, moveIfEqual) {
        var deltaIsInsert = delta.action == "insert";
        var deltaRowShift = (deltaIsInsert ? 1 : -1) * (delta.end.row    - delta.start.row);
        var deltaColShift = (deltaIsInsert ? 1 : -1) * (delta.end.column - delta.start.column);
        var deltaStart = delta.start;
        var deltaEnd = deltaIsInsert ? deltaStart : delta.end; // Collapse insert range.
        if ($pointsInOrder(point, deltaStart, moveIfEqual)) {
            return {
                row: point.row,
                column: point.column
            };
        }
        if ($pointsInOrder(deltaEnd, point, !moveIfEqual)) {
            return {
                row: point.row + deltaRowShift,
                column: point.column + (point.row == deltaEnd.row ? deltaColShift : 0)
            };
        }
        
        return {
            row: deltaStart.row,
            column: deltaStart.column
        };
    }
    this.setPosition = function(row, column, noClip) {
        var pos;
        if (noClip) {
            pos = {
                row: row,
                column: column
            };
        } else {
            pos = this.$clipPositionToDocument(row, column);
        }

        if (this.row == pos.row && this.column == pos.column)
            return;

        var old = {
            row: this.row,
            column: this.column
        };

        this.row = pos.row;
        this.column = pos.column;
        this._signal("change", {
            old: old,
            value: pos
        });
    };
    this.detach = function() {
        this.document.removeEventListener("change", this.$onChange);
    };
    this.attach = function(doc) {
        this.document = doc || this.document;
        this.document.on("change", this.$onChange);
    };
    this.$clipPositionToDocument = function(row, column) {
        var pos = {};

        if (row >= this.document.getLength()) {
            pos.row = Math.max(0, this.document.getLength() - 1);
            pos.column = this.document.getLine(pos.row).length;
        }
        else if (row < 0) {
            pos.row = 0;
            pos.column = 0;
        }
        else {
            pos.row = row;
            pos.column = Math.min(this.document.getLine(pos.row).length, Math.max(0, column));
        }

        if (column < 0)
            pos.column = 0;

        return pos;
    };

}).call(Anchor.prototype);

});

ace.define("ace/document",[], function(require, exports, module) {
"use strict";

var oop = require("./lib/oop");
var applyDelta = require("./apply_delta").applyDelta;
var EventEmitter = require("./lib/event_emitter").EventEmitter;
var Range = require("./range").Range;
var Anchor = require("./anchor").Anchor;

var Document = function(textOrLines) {
    this.$lines = [""];
    if (textOrLines.length === 0) {
        this.$lines = [""];
    } else if (Array.isArray(textOrLines)) {
        this.insertMergedLines({row: 0, column: 0}, textOrLines);
    } else {
        this.insert({row: 0, column:0}, textOrLines);
    }
};

(function() {

    oop.implement(this, EventEmitter);
    this.setValue = function(text) {
        var len = this.getLength() - 1;
        this.remove(new Range(0, 0, len, this.getLine(len).length));
        this.insert({row: 0, column: 0}, text);
    };
    this.getValue = function() {
        return this.getAllLines().join(this.getNewLineCharacter());
    };
    this.createAnchor = function(row, column) {
        return new Anchor(this, row, column);
    };
    if ("aaa".split(/a/).length === 0) {
        this.$split = function(text) {
            return text.replace(/\r\n|\r/g, "\n").split("\n");
        };
    } else {
        this.$split = function(text) {
            return text.split(/\r\n|\r|\n/);
        };
    }


    this.$detectNewLine = function(text) {
        var match = text.match(/^.*?(\r\n|\r|\n)/m);
        this.$autoNewLine = match ? match[1] : "\n";
        this._signal("changeNewLineMode");
    };
    this.getNewLineCharacter = function() {
        switch (this.$newLineMode) {
          case "windows":
            return "\r\n";
          case "unix":
            return "\n";
          default:
            return this.$autoNewLine || "\n";
        }
    };

    this.$autoNewLine = "";
    this.$newLineMode = "auto";
    this.setNewLineMode = function(newLineMode) {
        if (this.$newLineMode === newLineMode)
            return;

        this.$newLineMode = newLineMode;
        this._signal("changeNewLineMode");
    };
    this.getNewLineMode = function() {
        return this.$newLineMode;
    };
    this.isNewLine = function(text) {
        return (text == "\r\n" || text == "\r" || text == "\n");
    };
    this.getLine = function(row) {
        return this.$lines[row] || "";
    };
    this.getLines = function(firstRow, lastRow) {
        return this.$lines.slice(firstRow, lastRow + 1);
    };
    this.getAllLines = function() {
        return this.getLines(0, this.getLength());
    };
    this.getLength = function() {
        return this.$lines.length;
    };
    this.getTextRange = function(range) {
        return this.getLinesForRange(range).join(this.getNewLineCharacter());
    };
    this.getLinesForRange = function(range) {
        var lines;
        if (range.start.row === range.end.row) {
            lines = [this.getLine(range.start.row).substring(range.start.column, range.end.column)];
        } else {
            lines = this.getLines(range.start.row, range.end.row);
            lines[0] = (lines[0] || "").substring(range.start.column);
            var l = lines.length - 1;
            if (range.end.row - range.start.row == l)
                lines[l] = lines[l].substring(0, range.end.column);
        }
        return lines;
    };
    this.insertLines = function(row, lines) {
        console.warn("Use of document.insertLines is deprecated. Use the insertFullLines method instead.");
        return this.insertFullLines(row, lines);
    };
    this.removeLines = function(firstRow, lastRow) {
        console.warn("Use of document.removeLines is deprecated. Use the removeFullLines method instead.");
        return this.removeFullLines(firstRow, lastRow);
    };
    this.insertNewLine = function(position) {
        console.warn("Use of document.insertNewLine is deprecated. Use insertMergedLines(position, ['', '']) instead.");
        return this.insertMergedLines(position, ["", ""]);
    };
    this.insert = function(position, text) {
        if (this.getLength() <= 1)
            this.$detectNewLine(text);
        
        return this.insertMergedLines(position, this.$split(text));
    };
    this.insertInLine = function(position, text) {
        var start = this.clippedPos(position.row, position.column);
        var end = this.pos(position.row, position.column + text.length);
        
        this.applyDelta({
            start: start,
            end: end,
            action: "insert",
            lines: [text]
        }, true);
        
        return this.clonePos(end);
    };
    
    this.clippedPos = function(row, column) {
        var length = this.getLength();
        if (row === undefined) {
            row = length;
        } else if (row < 0) {
            row = 0;
        } else if (row >= length) {
            row = length - 1;
            column = undefined;
        }
        var line = this.getLine(row);
        if (column == undefined)
            column = line.length;
        column = Math.min(Math.max(column, 0), line.length);
        return {row: row, column: column};
    };
    
    this.clonePos = function(pos) {
        return {row: pos.row, column: pos.column};
    };
    
    this.pos = function(row, column) {
        return {row: row, column: column};
    };
    
    this.$clipPosition = function(position) {
        var length = this.getLength();
        if (position.row >= length) {
            position.row = Math.max(0, length - 1);
            position.column = this.getLine(length - 1).length;
        } else {
            position.row = Math.max(0, position.row);
            position.column = Math.min(Math.max(position.column, 0), this.getLine(position.row).length);
        }
        return position;
    };
    this.insertFullLines = function(row, lines) {
        row = Math.min(Math.max(row, 0), this.getLength());
        var column = 0;
        if (row < this.getLength()) {
            lines = lines.concat([""]);
            column = 0;
        } else {
            lines = [""].concat(lines);
            row--;
            column = this.$lines[row].length;
        }
        this.insertMergedLines({row: row, column: column}, lines);
    };    
    this.insertMergedLines = function(position, lines) {
        var start = this.clippedPos(position.row, position.column);
        var end = {
            row: start.row + lines.length - 1,
            column: (lines.length == 1 ? start.column : 0) + lines[lines.length - 1].length
        };
        
        this.applyDelta({
            start: start,
            end: end,
            action: "insert",
            lines: lines
        });
        
        return this.clonePos(end);
    };
    this.remove = function(range) {
        var start = this.clippedPos(range.start.row, range.start.column);
        var end = this.clippedPos(range.end.row, range.end.column);
        this.applyDelta({
            start: start,
            end: end,
            action: "remove",
            lines: this.getLinesForRange({start: start, end: end})
        });
        return this.clonePos(start);
    };
    this.removeInLine = function(row, startColumn, endColumn) {
        var start = this.clippedPos(row, startColumn);
        var end = this.clippedPos(row, endColumn);
        
        this.applyDelta({
            start: start,
            end: end,
            action: "remove",
            lines: this.getLinesForRange({start: start, end: end})
        }, true);
        
        return this.clonePos(start);
    };
    this.removeFullLines = function(firstRow, lastRow) {
        firstRow = Math.min(Math.max(0, firstRow), this.getLength() - 1);
        lastRow  = Math.min(Math.max(0, lastRow ), this.getLength() - 1);
        var deleteFirstNewLine = lastRow == this.getLength() - 1 && firstRow > 0;
        var deleteLastNewLine  = lastRow  < this.getLength() - 1;
        var startRow = ( deleteFirstNewLine ? firstRow - 1                  : firstRow                    );
        var startCol = ( deleteFirstNewLine ? this.getLine(startRow).length : 0                           );
        var endRow   = ( deleteLastNewLine  ? lastRow + 1                   : lastRow                     );
        var endCol   = ( deleteLastNewLine  ? 0                             : this.getLine(endRow).length ); 
        var range = new Range(startRow, startCol, endRow, endCol);
        var deletedLines = this.$lines.slice(firstRow, lastRow + 1);
        
        this.applyDelta({
            start: range.start,
            end: range.end,
            action: "remove",
            lines: this.getLinesForRange(range)
        });
        return deletedLines;
    };
    this.removeNewLine = function(row) {
        if (row < this.getLength() - 1 && row >= 0) {
            this.applyDelta({
                start: this.pos(row, this.getLine(row).length),
                end: this.pos(row + 1, 0),
                action: "remove",
                lines: ["", ""]
            });
        }
    };
    this.replace = function(range, text) {
        if (!(range instanceof Range))
            range = Range.fromPoints(range.start, range.end);
        if (text.length === 0 && range.isEmpty())
            return range.start;
        if (text == this.getTextRange(range))
            return range.end;

        this.remove(range);
        var end;
        if (text) {
            end = this.insert(range.start, text);
        }
        else {
            end = range.start;
        }
        
        return end;
    };
    this.applyDeltas = function(deltas) {
        for (var i=0; i<deltas.length; i++) {
            this.applyDelta(deltas[i]);
        }
    };
    this.revertDeltas = function(deltas) {
        for (var i=deltas.length-1; i>=0; i--) {
            this.revertDelta(deltas[i]);
        }
    };
    this.applyDelta = function(delta, doNotValidate) {
        var isInsert = delta.action == "insert";
        if (isInsert ? delta.lines.length <= 1 && !delta.lines[0]
            : !Range.comparePoints(delta.start, delta.end)) {
            return;
        }
        
        if (isInsert && delta.lines.length > 20000) {
            this.$splitAndapplyLargeDelta(delta, 20000);
        }
        else {
            applyDelta(this.$lines, delta, doNotValidate);
            this._signal("change", delta);
        }
    };
    
    this.$splitAndapplyLargeDelta = function(delta, MAX) {
        var lines = delta.lines;
        var l = lines.length - MAX + 1;
        var row = delta.start.row; 
        var column = delta.start.column;
        for (var from = 0, to = 0; from < l; from = to) {
            to += MAX - 1;
            var chunk = lines.slice(from, to);
            chunk.push("");
            this.applyDelta({
                start: this.pos(row + from, column),
                end: this.pos(row + to, column = 0),
                action: delta.action,
                lines: chunk
            }, true);
        }
        delta.lines = lines.slice(from);
        delta.start.row = row + from;
        delta.start.column = column;
        this.applyDelta(delta, true);
    };
    this.revertDelta = function(delta) {
        this.applyDelta({
            start: this.clonePos(delta.start),
            end: this.clonePos(delta.end),
            action: (delta.action == "insert" ? "remove" : "insert"),
            lines: delta.lines.slice()
        });
    };
    this.indexToPosition = function(index, startRow) {
        var lines = this.$lines || this.getAllLines();
        var newlineLength = this.getNewLineCharacter().length;
        for (var i = startRow || 0, l = lines.length; i < l; i++) {
            index -= lines[i].length + newlineLength;
            if (index < 0)
                return {row: i, column: index + lines[i].length + newlineLength};
        }
        return {row: l-1, column: index + lines[l-1].length + newlineLength};
    };
    this.positionToIndex = function(pos, startRow) {
        var lines = this.$lines || this.getAllLines();
        var newlineLength = this.getNewLineCharacter().length;
        var index = 0;
        var row = Math.min(pos.row, lines.length);
        for (var i = startRow || 0; i < row; ++i)
            index += lines[i].length + newlineLength;

        return index + pos.column;
    };

}).call(Document.prototype);

exports.Document = Document;
});

ace.define("ace/lib/lang",[], function(require, exports, module) {
"use strict";

exports.last = function(a) {
    return a[a.length - 1];
};

exports.stringReverse = function(string) {
    return string.split("").reverse().join("");
};

exports.stringRepeat = function (string, count) {
    var result = '';
    while (count > 0) {
        if (count & 1)
            result += string;

        if (count >>= 1)
            string += string;
    }
    return result;
};

var trimBeginRegexp = /^\s\s*/;
var trimEndRegexp = /\s\s*$/;

exports.stringTrimLeft = function (string) {
    return string.replace(trimBeginRegexp, '');
};

exports.stringTrimRight = function (string) {
    return string.replace(trimEndRegexp, '');
};

exports.copyObject = function(obj) {
    var copy = {};
    for (var key in obj) {
        copy[key] = obj[key];
    }
    return copy;
};

exports.copyArray = function(array){
    var copy = [];
    for (var i=0, l=array.length; i<l; i++) {
        if (array[i] && typeof array[i] == "object")
            copy[i] = this.copyObject(array[i]);
        else 
            copy[i] = array[i];
    }
    return copy;
};

exports.deepCopy = function deepCopy(obj) {
    if (typeof obj !== "object" || !obj)
        return obj;
    var copy;
    if (Array.isArray(obj)) {
        copy = [];
        for (var key = 0; key < obj.length; key++) {
            copy[key] = deepCopy(obj[key]);
        }
        return copy;
    }
    if (Object.prototype.toString.call(obj) !== "[object Object]")
        return obj;
    
    copy = {};
    for (var key in obj)
        copy[key] = deepCopy(obj[key]);
    return copy;
};

exports.arrayToMap = function(arr) {
    var map = {};
    for (var i=0; i<arr.length; i++) {
        map[arr[i]] = 1;
    }
    return map;

};

exports.createMap = function(props) {
    var map = Object.create(null);
    for (var i in props) {
        map[i] = props[i];
    }
    return map;
};
exports.arrayRemove = function(array, value) {
  for (var i = 0; i <= array.length; i++) {
    if (value === array[i]) {
      array.splice(i, 1);
    }
  }
};

exports.escapeRegExp = function(str) {
    return str.replace(/([.*+?^${}()|[\]\/\\])/g, '\\$1');
};

exports.escapeHTML = function(str) {
    return ("" + str).replace(/&/g, "&#38;").replace(/"/g, "&#34;").replace(/'/g, "&#39;").replace(/</g, "&#60;");
};

exports.getMatchOffsets = function(string, regExp) {
    var matches = [];

    string.replace(regExp, function(str) {
        matches.push({
            offset: arguments[arguments.length-2],
            length: str.length
        });
    });

    return matches;
};
exports.deferredCall = function(fcn) {
    var timer = null;
    var callback = function() {
        timer = null;
        fcn();
    };

    var deferred = function(timeout) {
        deferred.cancel();
        timer = setTimeout(callback, timeout || 0);
        return deferred;
    };

    deferred.schedule = deferred;

    deferred.call = function() {
        this.cancel();
        fcn();
        return deferred;
    };

    deferred.cancel = function() {
        clearTimeout(timer);
        timer = null;
        return deferred;
    };
    
    deferred.isPending = function() {
        return timer;
    };

    return deferred;
};


exports.delayedCall = function(fcn, defaultTimeout) {
    var timer = null;
    var callback = function() {
        timer = null;
        fcn();
    };

    var _self = function(timeout) {
        if (timer == null)
            timer = setTimeout(callback, timeout || defaultTimeout);
    };

    _self.delay = function(timeout) {
        timer && clearTimeout(timer);
        timer = setTimeout(callback, timeout || defaultTimeout);
    };
    _self.schedule = _self;

    _self.call = function() {
        this.cancel();
        fcn();
    };

    _self.cancel = function() {
        timer && clearTimeout(timer);
        timer = null;
    };

    _self.isPending = function() {
        return timer;
    };

    return _self;
};
});

ace.define("ace/worker/mirror",[], function(require, exports, module) {
"use strict";

var Range = require("../range").Range;
var Document = require("../document").Document;
var lang = require("../lib/lang");
    
var Mirror = exports.Mirror = function(sender) {
    this.sender = sender;
    var doc = this.doc = new Document("");
    
    var deferredUpdate = this.deferredUpdate = lang.delayedCall(this.onUpdate.bind(this));
    
    var _self = this;
    sender.on("change", function(e) {
        var data = e.data;
        if (data[0].start) {
            doc.applyDeltas(data);
        } else {
            for (var i = 0; i < data.length; i += 2) {
                if (Array.isArray(data[i+1])) {
                    var d = {action: "insert", start: data[i], lines: data[i+1]};
                } else {
                    var d = {action: "remove", start: data[i], end: data[i+1]};
                }
                doc.applyDelta(d, true);
            }
        }
        if (_self.$timeout)
            return deferredUpdate.schedule(_self.$timeout);
        _self.onUpdate();
    });
};

(function() {
    
    this.$timeout = 500;
    
    this.setTimeout = function(timeout) {
        this.$timeout = timeout;
    };
    
    this.setValue = function(value) {
        this.doc.setValue(value);
        this.deferredUpdate.schedule(this.$timeout);
    };
    
    this.getValue = function(callbackId) {
        this.sender.callback(this.doc.getValue(), callbackId);
    };
    
    this.onUpdate = function() {
    };
    
    this.isPending = function() {
        return this.deferredUpdate.isPending();
    };
    
}).call(Mirror.prototype);

});

ace.define("ace/mode/python/asserts",["require","exports","module"], function(require, exports, module) {
"no use strict";
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
exports.assert = assert;

function fail(message, unknown, whatever) {
    exports.assert(false, message);
}
exports.fail = fail;
});

ace.define("ace/mode/python/base",["require","exports","module"], function(require, exports, module) {
"no use strict";
function typeOf(value) {
    var s = typeof value;
    if (s == 'object') {
        if (value) {
            if (value instanceof Array) {
                return 'array';
            } else if (value instanceof Object) {
                return s;
            }
            var className = Object.prototype.toString.call((value));
            if (className == '[object Window]') {
                return 'object';
            }
            if ((className == '[object Array]' || typeof value.length == 'number' && typeof value.splice != 'undefined' && typeof value.propertyIsEnumerable != 'undefined' && !value.propertyIsEnumerable('splice'))) {
                return 'array';
            }
            if ((className == '[object Function]' || typeof value.call != 'undefined' && typeof value.propertyIsEnumerable != 'undefined' && !value.propertyIsEnumerable('call'))) {
                return 'function';
            }
        } else {
            return 'null';
        }
    } else if (s == 'function' && typeof value.call == 'undefined') {
        return 'object';
    }
    return s;
}
exports.typeOf = typeOf;
;
function isNumber(val) {
    return typeof val === 'number';
}
exports.isNumber = isNumber;
function isString(val) {
    return typeof val === 'string';
}
exports.isString = isString;
function isDef(val) {
    return val !== undefined;
}
exports.isDef = isDef;
function isArrayLike(val) {
    var type = exports.typeOf(val);
    return type == 'array' || type == 'object' && typeof val.length == 'number';
}
exports.isArrayLike = isArrayLike;
;
});

ace.define("ace/mode/python/IndentationError",["require","exports","module"], function(require, exports, module) {
"no use strict";
var IndentationError = (function () {
    function IndentationError(message, fileName, begin, end, text) {
    }
    return IndentationError;
})();

    return IndentationError;
});

ace.define("ace/mode/python/TokenError",["require","exports","module","ace/mode/python/asserts","ace/mode/python/base"], function(require, exports, module) {
"no use strict";
var asserts = require('./asserts');
var base = require('./base');

var TokenError = (function () {
    function TokenError(message, fileName, lineNumber, columnNumber) {
        this.name = 'TokenError';
        asserts.assert(base.isString(message), "message must be a string");
        asserts.assert(base.isString(fileName), "fileName must be a string");
        asserts.assert(base.isNumber(lineNumber), "lineNumber must be a number");
        asserts.assert(base.isNumber(columnNumber), "columnNumber must be a number");

        this.message = message;
        this.fileName = fileName;
        this.lineNumber = lineNumber;
        this.columnNumber = columnNumber;
    }
    return TokenError;
})();

    return TokenError;
});

ace.define("ace/mode/python/Tokenizer",["require","exports","module","ace/mode/python/asserts","ace/mode/python/base","ace/mode/python/IndentationError","ace/mode/python/TokenError"], function(require, exports, module) {
"no use strict";
var asserts = require('./asserts');
var base = require('./base');
var IndentationError = require('./IndentationError');
var TokenError = require('./TokenError');
function group() {
    var x = [];
    for (var _i = 0; _i < (arguments.length - 0); _i++) {
        x[_i] = arguments[_i + 0];
    }
    var args = Array.prototype.slice.call(arguments);
    return '(' + args.join('|') + ')';
}
function any(x) {
    return group.apply(null, arguments) + "*";
}
function maybe(x) {
    return group.apply(null, arguments) + "?";
}
var Whitespace = "[ \\f\\t]*";
var Comment_ = "#[^\\r\\n]*";
var Ident = "[a-zA-Z_]\\w*";

var Binnumber = '0[bB][01]*';
var Hexnumber = '0[xX][\\da-fA-F]*[lL]?';
var Octnumber = '0[oO]?[0-7]*[lL]?';
var Decnumber = '[1-9]\\d*[lL]?';
var Intnumber = group(Binnumber, Hexnumber, Octnumber, Decnumber);

var Exponent = "[eE][-+]?\\d+";
var Pointfloat = group("\\d+\\.\\d*", "\\.\\d+") + maybe(Exponent);
var Expfloat = '\\d+' + Exponent;
var Floatnumber = group(Pointfloat, Expfloat);
var Imagnumber = group("\\d+[jJ]", Floatnumber + "[jJ]");
var Number_ = group(Imagnumber, Floatnumber, Intnumber);
var Single = "^[^'\\\\]*(?:\\\\.[^'\\\\]*)*'";
var Double_ = '^[^"\\\\]*(?:\\\\.[^"\\\\]*)*"';
var Single3 = "[^'\\\\]*(?:(?:\\\\.|'(?!''))[^'\\\\]*)*'''";
var Double3 = '[^"\\\\]*(?:(?:\\\\.|"(?!""))[^"\\\\]*)*"""';
var Triple = group("[ubUB]?[rR]?'''", '[ubUB]?[rR]?"""');
var String_ = group("[uU]?[rR]?'[^\\n'\\\\]*(?:\\\\.[^\\n'\\\\]*)*'", '[uU]?[rR]?"[^\\n"\\\\]*(?:\\\\.[^\\n"\\\\]*)*"');
var Operator = group("\\*\\*=?", ">>=?", "<<=?", "<>", "!=", "//=?", "->", "[+\\-*/%&|^=<>]=?", "~");

var Bracket = '[\\][(){}]';
var Special = group('\\r?\\n', '[:;.,`@]');
var Funny = group(Operator, Bracket, Special);

var ContStr = group("[uUbB]?[rR]?'[^\\n'\\\\]*(?:\\\\.[^\\n'\\\\]*)*" + group("'", '\\\\\\r?\\n'), '[uUbB]?[rR]?"[^\\n"\\\\]*(?:\\\\.[^\\n"\\\\]*)*' + group('"', '\\\\\\r?\\n'));
var PseudoExtras = group('\\\\\\r?\\n', Comment_, Triple);
var PseudoToken = "^" + group(PseudoExtras, Number_, Funny, ContStr, Ident);

var pseudoprog;
var single3prog;
var double3prog;
var endprogs = {};

var triple_quoted = {
    "'''": true, '"""': true,
    "r'''": true, 'r"""': true, "R'''": true, 'R"""': true,
    "u'''": true, 'u"""': true, "U'''": true, 'U"""': true,
    "b'''": true, 'b"""': true, "B'''": true, 'B"""': true,
    "ur'''": true, 'ur"""': true, "Ur'''": true, 'Ur"""': true,
    "uR'''": true, 'uR"""': true, "UR'''": true, 'UR"""': true,
    "br'''": true, 'br"""': true, "Br'''": true, 'Br"""': true,
    "bR'''": true, 'bR"""': true, "BR'''": true, 'BR"""': true
};

var single_quoted = {
    "'": true, '"': true,
    "r'": true, 'r"': true, "R'": true, 'R"': true,
    "u'": true, 'u"': true, "U'": true, 'U"': true,
    "b'": true, 'b"': true, "B'": true, 'B"': true,
    "ur'": true, 'ur"': true, "Ur'": true, 'Ur"': true,
    "uR'": true, 'uR"': true, "UR'": true, 'UR"': true,
    "br'": true, 'br"': true, "Br'": true, 'Br"': true,
    "bR'": true, 'bR"': true, "BR'": true, 'BR"': true
};
(function () {
    for (var k in triple_quoted) {
    }
    for (var k in single_quoted) {
    }
}());

var tabsize = 8;

function contains(a, obj) {
    var i = a.length;
    while (i--) {
        if (a[i] === obj) {
            return true;
        }
    }
    return false;
}

function rstrip(input, what) {
    for (var i = input.length; i > 0; --i) {
        if (what.indexOf(input.charAt(i - 1)) === -1)
            break;
    }
    return input.substring(0, i);
}
var Tokenizer = (function () {
    function Tokenizer(fileName, interactive, callback) {
        this.lnum = 0;
        this.parenlev = 0;
        this.continued = false;
        this.namechars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_';
        this.numchars = '0123456789';
        this.contstr = '';
        this.needcont = false;
        this.contline = undefined;
        this.indents = [0];
        this.endprog = /.*/;
        this.strstart = [-1, -1];
        asserts.assert(base.isString(fileName), "fileName must be a string");

        this.fileName = fileName;
        this.interactive = interactive;
        this.callback = callback;

        this.doneFunc = function () {
            for (var i = 1; i < this.indents.length; ++i) {
                if (this.callback(Tokenizer.Tokens.T_DEDENT, '', [this.lnum, 0], [this.lnum, 0], ''))
                    return 'done';
            }
            if (this.callback(Tokenizer.Tokens.T_ENDMARKER, '', [this.lnum, 0], [this.lnum, 0], ''))
                return 'done';

            return 'failed';
        };
    }
    Tokenizer.prototype.generateTokens = function (line) {
        var endmatch;
        var pos;
        var column;
        var end;
        var max;
        var pseudoprog = new RegExp(PseudoToken);
        var single3prog = new RegExp(Single3, "g");
        var double3prog = new RegExp(Double3, "g");

        var endprogs = {
            "'": new RegExp(Single, "g"), '"': new RegExp(Double_, "g"),
            "'''": single3prog, '"""': double3prog,
            "r'''": single3prog, 'r"""': double3prog,
            "u'''": single3prog, 'u"""': double3prog,
            "b'''": single3prog, 'b"""': double3prog,
            "ur'''": single3prog, 'ur"""': double3prog,
            "br'''": single3prog, 'br"""': double3prog,
            "R'''": single3prog, 'R"""': double3prog,
            "U'''": single3prog, 'U"""': double3prog,
            "B'''": single3prog, 'B"""': double3prog,
            "uR'''": single3prog, 'uR"""': double3prog,
            "Ur'''": single3prog, 'Ur"""': double3prog,
            "UR'''": single3prog, 'UR"""': double3prog,
            "bR'''": single3prog, 'bR"""': double3prog,
            "Br'''": single3prog, 'Br"""': double3prog,
            "BR'''": single3prog, 'BR"""': double3prog,
            'r': null, 'R': null,
            'u': null, 'U': null,
            'b': null, 'B': null
        };

        if (!line)
            line = '';

        this.lnum += 1;
        pos = 0;
        max = line.length;

        if (this.contstr.length > 0) {
            if (!line) {
                throw new TokenError("EOF in multi-line string", this.fileName, this.strstart[0], this.strstart[1]);
            }
            this.endprog.lastIndex = 0;
            endmatch = this.endprog.test(line);
            if (endmatch) {
                pos = end = this.endprog.lastIndex;
                if (this.callback(Tokenizer.Tokens.T_STRING, this.contstr + line.substring(0, end), this.strstart, [this.lnum, end], this.contline + line)) {
                    return 'done';
                }
                this.contstr = '';
                this.needcont = false;
                this.contline = undefined;
            } else if (this.needcont && line.substring(line.length - 2) !== "\\\n" && line.substring(line.length - 3) !== "\\\r\n") {
                if (this.callback(Tokenizer.Tokens.T_ERRORTOKEN, this.contstr + line, this.strstart, [this.lnum, line.length], this.contline)) {
                    return 'done';
                }
                this.contstr = '';
                this.contline = undefined;
                return false;
            } else {
                this.contstr += line;
                this.contline = this.contline + line;
                return false;
            }
        } else if (this.parenlev === 0 && !this.continued) {
            if (!line)
                return this.doneFunc();
            column = 0;
            while (pos < max) {
                if (line.charAt(pos) === ' ')
                    column += 1;
                else if (line.charAt(pos) === '\t')
                    column = (column / tabsize + 1) * tabsize;
                else if (line.charAt(pos) === '\f')
                    column = 0;
                else
                    break;
                pos = pos + 1;
            }
            if (pos === max)
                return this.doneFunc();

            if ("#\r\n".indexOf(line.charAt(pos)) !== -1) {
                if (line.charAt(pos) === '#') {
                    var comment_token = rstrip(line.substring(pos), '\r\n');
                    var nl_pos = pos + comment_token.length;
                    if (this.callback(Tokenizer.Tokens.T_COMMENT, comment_token, [this.lnum, pos], [this.lnum, pos + comment_token.length], line))
                        return 'done';
                    if (this.callback(Tokenizer.Tokens.T_NL, line.substring(nl_pos), [this.lnum, nl_pos], [this.lnum, line.length], line))
                        return 'done';
                    return false;
                } else {
                    if (this.callback(Tokenizer.Tokens.T_NL, line.substring(pos), [this.lnum, pos], [this.lnum, line.length], line))
                        return 'done';
                    if (!this.interactive)
                        return false;
                }
            }

            if (column > this.indents[this.indents.length - 1]) {
                this.indents.push(column);
                if (this.callback(Tokenizer.Tokens.T_INDENT, line.substring(0, pos), [this.lnum, 0], [this.lnum, pos], line))
                    return 'done';
            }
            while (column < this.indents[this.indents.length - 1]) {
                if (!contains(this.indents, column)) {
                    throw new IndentationError("unindent does not match any outer indentation level", this.fileName, [this.lnum, 0], [this.lnum, pos], line);
                }
                this.indents.splice(this.indents.length - 1, 1);
                if (this.callback(Tokenizer.Tokens.T_DEDENT, '', [this.lnum, pos], [this.lnum, pos], line)) {
                    return 'done';
                }
            }
        } else {
            if (!line) {
                throw new TokenError("EOF in multi-line statement", this.fileName, this.lnum, 0);
            }
            this.continued = false;
        }

        while (pos < max) {
            var capos = line.charAt(pos);
            while (capos === ' ' || capos === '\f' || capos === '\t') {
                pos += 1;
                capos = line.charAt(pos);
            }
            pseudoprog.lastIndex = 0;
            var pseudomatch = pseudoprog.exec(line.substring(pos));
            if (pseudomatch) {
                var start = pos;
                end = start + pseudomatch[1].length;
                var spos = [this.lnum, start];
                var epos = [this.lnum, end];
                pos = end;
                var token = line.substring(start, end);
                var initial = line.charAt(start);
                if (this.numchars.indexOf(initial) !== -1 || (initial === '.' && token !== '.')) {
                    if (this.callback(Tokenizer.Tokens.T_NUMBER, token, spos, epos, line))
                        return 'done';
                } else if (initial === '\r' || initial === '\n') {
                    var newl = Tokenizer.Tokens.T_NEWLINE;
                    if (this.parenlev > 0)
                        newl = Tokenizer.Tokens.T_NL;
                    if (this.callback(newl, token, spos, epos, line))
                        return 'done';
                } else if (initial === '#') {
                    if (this.callback(Tokenizer.Tokens.T_COMMENT, token, spos, epos, line))
                        return 'done';
                } else if (triple_quoted.hasOwnProperty(token)) {
                    this.endprog = endprogs[token];
                    this.endprog.lastIndex = 0;
                    endmatch = this.endprog.test(line.substring(pos));
                    if (endmatch) {
                        pos = this.endprog.lastIndex + pos;
                        token = line.substring(start, pos);
                        if (this.callback(Tokenizer.Tokens.T_STRING, token, spos, [this.lnum, pos], line))
                            return 'done';
                    } else {
                        this.strstart = [this.lnum, start];
                        this.contstr = line.substring(start);
                        this.contline = line;
                        return false;
                    }
                } else if (single_quoted.hasOwnProperty(initial) || single_quoted.hasOwnProperty(token.substring(0, 2)) || single_quoted.hasOwnProperty(token.substring(0, 3))) {
                    if (token[token.length - 1] === '\n') {
                        this.strstart = [this.lnum, start];
                        this.endprog = endprogs[initial] || endprogs[token[1]] || endprogs[token[2]];
                        this.contstr = line.substring(start);
                        this.needcont = true;
                        this.contline = line;
                        return false;
                    } else {
                        if (this.callback(Tokenizer.Tokens.T_STRING, token, spos, epos, line))
                            return 'done';
                    }
                } else if (this.namechars.indexOf(initial) !== -1) {
                    if (this.callback(Tokenizer.Tokens.T_NAME, token, spos, epos, line))
                        return 'done';
                } else if (initial === '\\') {
                    if (this.callback(Tokenizer.Tokens.T_NL, token, spos, [this.lnum, pos], line))
                        return 'done';
                    this.continued = true;
                } else {
                    if ('([{'.indexOf(initial) !== -1)
                        this.parenlev += 1;
                    else if (')]}'.indexOf(initial) !== -1)
                        this.parenlev -= 1;
                    if (this.callback(Tokenizer.Tokens.T_OP, token, spos, epos, line))
                        return 'done';
                }
            } else {
                if (this.callback(Tokenizer.Tokens.T_ERRORTOKEN, line.charAt(pos), [this.lnum, pos], [this.lnum, pos + 1], line)) {
                    return 'done';
                }
                pos += 1;
            }
        }

        return false;
    };
    Tokenizer.Tokens = {
        T_ENDMARKER: 0,
        T_NAME: 1,
        T_NUMBER: 2,
        T_STRING: 3,
        T_NEWLINE: 4,
        T_INDENT: 5,
        T_DEDENT: 6,
        T_LPAR: 7,
        T_RPAR: 8,
        T_LSQB: 9,
        T_RSQB: 10,
        T_COLON: 11,
        T_COMMA: 12,
        T_SEMI: 13,
        T_PLUS: 14,
        T_MINUS: 15,
        T_STAR: 16,
        T_SLASH: 17,
        T_VBAR: 18,
        T_AMPER: 19,
        T_LESS: 20,
        T_GREATER: 21,
        T_EQUAL: 22,
        T_DOT: 23,
        T_PERCENT: 24,
        T_BACKQUOTE: 25,
        T_LBRACE: 26,
        T_RBRACE: 27,
        T_EQEQUAL: 28,
        T_NOTEQUAL: 29,
        T_LESSEQUAL: 30,
        T_GREATEREQUAL: 31,
        T_TILDE: 32,
        T_CIRCUMFLEX: 33,
        T_LEFTSHIFT: 34,
        T_RIGHTSHIFT: 35,
        T_DOUBLESTAR: 36,
        T_PLUSEQUAL: 37,
        T_MINEQUAL: 38,
        T_STAREQUAL: 39,
        T_SLASHEQUAL: 40,
        T_PERCENTEQUAL: 41,
        T_AMPEREQUAL: 42,
        T_VBAREQUAL: 43,
        T_CIRCUMFLEXEQUAL: 44,
        T_LEFTSHIFTEQUAL: 45,
        T_RIGHTSHIFTEQUAL: 46,
        T_DOUBLESTAREQUAL: 47,
        T_DOUBLESLASH: 48,
        T_DOUBLESLASHEQUAL: 49,
        T_AT: 50,
        T_OP: 51,
        T_COMMENT: 52,
        T_NL: 53,
        T_RARROW: 54,
        T_ERRORTOKEN: 55,
        T_N_TOKENS: 56,
        T_NT_OFFSET: 256
    };

    Tokenizer.tokenNames = {
        0: 'T_ENDMARKER', 1: 'T_NAME', 2: 'T_NUMBER', 3: 'T_STRING', 4: 'T_NEWLINE',
        5: 'T_INDENT', 6: 'T_DEDENT', 7: 'T_LPAR', 8: 'T_RPAR', 9: 'T_LSQB',
        10: 'T_RSQB', 11: 'T_COLON', 12: 'T_COMMA', 13: 'T_SEMI', 14: 'T_PLUS',
        15: 'T_MINUS', 16: 'T_STAR', 17: 'T_SLASH', 18: 'T_VBAR', 19: 'T_AMPER',
        20: 'T_LESS', 21: 'T_GREATER', 22: 'T_EQUAL', 23: 'T_DOT', 24: 'T_PERCENT',
        25: 'T_BACKQUOTE', 26: 'T_LBRACE', 27: 'T_RBRACE', 28: 'T_EQEQUAL', 29: 'T_NOTEQUAL',
        30: 'T_LESSEQUAL', 31: 'T_GREATEREQUAL', 32: 'T_TILDE', 33: 'T_CIRCUMFLEX', 34: 'T_LEFTSHIFT',
        35: 'T_RIGHTSHIFT', 36: 'T_DOUBLESTAR', 37: 'T_PLUSEQUAL', 38: 'T_MINEQUAL', 39: 'T_STAREQUAL',
        40: 'T_SLASHEQUAL', 41: 'T_PERCENTEQUAL', 42: 'T_AMPEREQUAL', 43: 'T_VBAREQUAL', 44: 'T_CIRCUMFLEXEQUAL',
        45: 'T_LEFTSHIFTEQUAL', 46: 'T_RIGHTSHIFTEQUAL', 47: 'T_DOUBLESTAREQUAL', 48: 'T_DOUBLESLASH', 49: 'T_DOUBLESLASHEQUAL',
        50: 'T_AT', 51: 'T_OP', 52: 'T_COMMENT', 53: 'T_NL', 54: 'T_RARROW',
        55: 'T_ERRORTOKEN', 56: 'T_N_TOKENS',
        256: 'T_NT_OFFSET'
    };
    return Tokenizer;
})();

    return Tokenizer;
});

ace.define("ace/mode/python/tables",["require","exports","module","ace/mode/python/Tokenizer"], function(require, exports, module) {
"no use strict";
var Tokenizer = require('./Tokenizer');

exports.OpMap = {
    "(": Tokenizer.Tokens.T_LPAR,
    ")": Tokenizer.Tokens.T_RPAR,
    "[": Tokenizer.Tokens.T_LSQB,
    "]": Tokenizer.Tokens.T_RSQB,
    ":": Tokenizer.Tokens.T_COLON,
    ",": Tokenizer.Tokens.T_COMMA,
    ";": Tokenizer.Tokens.T_SEMI,
    "+": Tokenizer.Tokens.T_PLUS,
    "-": Tokenizer.Tokens.T_MINUS,
    "*": Tokenizer.Tokens.T_STAR,
    "/": Tokenizer.Tokens.T_SLASH,
    "|": Tokenizer.Tokens.T_VBAR,
    "&": Tokenizer.Tokens.T_AMPER,
    "<": Tokenizer.Tokens.T_LESS,
    ">": Tokenizer.Tokens.T_GREATER,
    "=": Tokenizer.Tokens.T_EQUAL,
    ".": Tokenizer.Tokens.T_DOT,
    "%": Tokenizer.Tokens.T_PERCENT,
    "`": Tokenizer.Tokens.T_BACKQUOTE,
    "{": Tokenizer.Tokens.T_LBRACE,
    "}": Tokenizer.Tokens.T_RBRACE,
    "@": Tokenizer.Tokens.T_AT,
    "==": Tokenizer.Tokens.T_EQEQUAL,
    "!=": Tokenizer.Tokens.T_NOTEQUAL,
    "<>": Tokenizer.Tokens.T_NOTEQUAL,
    "<=": Tokenizer.Tokens.T_LESSEQUAL,
    ">=": Tokenizer.Tokens.T_GREATEREQUAL,
    "~": Tokenizer.Tokens.T_TILDE,
    "^": Tokenizer.Tokens.T_CIRCUMFLEX,
    "<<": Tokenizer.Tokens.T_LEFTSHIFT,
    ">>": Tokenizer.Tokens.T_RIGHTSHIFT,
    "**": Tokenizer.Tokens.T_DOUBLESTAR,
    "+=": Tokenizer.Tokens.T_PLUSEQUAL,
    "-=": Tokenizer.Tokens.T_MINEQUAL,
    "*=": Tokenizer.Tokens.T_STAREQUAL,
    "/=": Tokenizer.Tokens.T_SLASHEQUAL,
    "%=": Tokenizer.Tokens.T_PERCENTEQUAL,
    "&=": Tokenizer.Tokens.T_AMPEREQUAL,
    "|=": Tokenizer.Tokens.T_VBAREQUAL,
    "^=": Tokenizer.Tokens.T_CIRCUMFLEXEQUAL,
    "<<=": Tokenizer.Tokens.T_LEFTSHIFTEQUAL,
    ">>=": Tokenizer.Tokens.T_RIGHTSHIFTEQUAL,
    "**=": Tokenizer.Tokens.T_DOUBLESTAREQUAL,
    "//": Tokenizer.Tokens.T_DOUBLESLASH,
    "//=": Tokenizer.Tokens.T_DOUBLESLASHEQUAL,
    "->": Tokenizer.Tokens.T_RARROW
};

exports.ParseTables = {
    sym: {
        AndExpr: 257,
        ArithmeticExpr: 258,
        AtomExpr: 259,
        BitwiseAndExpr: 260,
        BitwiseOrExpr: 261,
        BitwiseXorExpr: 262,
        ComparisonExpr: 263,
        ExprList: 264,
        ExprStmt: 265,
        GeometricExpr: 266,
        GlobalStmt: 267,
        IfExpr: 268,
        LambdaExpr: 269,
        NonLocalStmt: 270,
        NotExpr: 271,
        OrExpr: 272,
        PowerExpr: 273,
        ShiftExpr: 274,
        UnaryExpr: 275,
        YieldExpr: 276,
        arglist: 277,
        argument: 278,
        assert_stmt: 279,
        augassign: 280,
        break_stmt: 281,
        classdef: 282,
        comp_op: 283,
        compound_stmt: 284,
        continue_stmt: 285,
        decorated: 286,
        decorator: 287,
        decorators: 288,
        del_stmt: 289,
        dictmaker: 290,
        dotted_as_name: 291,
        dotted_as_names: 292,
        dotted_name: 293,
        encoding_decl: 294,
        eval_input: 295,
        except_clause: 296,
        exec_stmt: 297,
        file_input: 298,
        flow_stmt: 299,
        for_stmt: 300,
        fpdef: 301,
        fplist: 302,
        funcdef: 303,
        gen_for: 304,
        gen_if: 305,
        gen_iter: 306,
        if_stmt: 307,
        import_as_name: 308,
        import_as_names: 309,
        import_from: 310,
        import_name: 311,
        import_stmt: 312,
        list_for: 313,
        list_if: 314,
        list_iter: 315,
        listmaker: 316,
        old_LambdaExpr: 317,
        old_test: 318,
        parameters: 319,
        pass_stmt: 320,
        print_stmt: 321,
        raise_stmt: 322,
        return_stmt: 323,
        simple_stmt: 324,
        single_input: 256,
        sliceop: 325,
        small_stmt: 326,
        stmt: 327,
        subscript: 328,
        subscriptlist: 329,
        suite: 330,
        testlist: 331,
        testlist1: 332,
        testlist_gexp: 333,
        testlist_safe: 334,
        trailer: 335,
        try_stmt: 336,
        varargslist: 337,
        while_stmt: 338,
        with_stmt: 339,
        with_var: 340,
        yield_stmt: 341 },
    number2symbol: {
        256: 'single_input',
        257: 'AndExpr',
        258: 'ArithmeticExpr',
        259: 'AtomExpr',
        260: 'BitwiseAndExpr',
        261: 'BitwiseOrExpr',
        262: 'BitwiseXorExpr',
        263: 'ComparisonExpr',
        264: 'ExprList',
        265: 'ExprStmt',
        266: 'GeometricExpr',
        267: 'GlobalStmt',
        268: 'IfExpr',
        269: 'LambdaExpr',
        270: 'NonLocalStmt',
        271: 'NotExpr',
        272: 'OrExpr',
        273: 'PowerExpr',
        274: 'ShiftExpr',
        275: 'UnaryExpr',
        276: 'YieldExpr',
        277: 'arglist',
        278: 'argument',
        279: 'assert_stmt',
        280: 'augassign',
        281: 'break_stmt',
        282: 'classdef',
        283: 'comp_op',
        284: 'compound_stmt',
        285: 'continue_stmt',
        286: 'decorated',
        287: 'decorator',
        288: 'decorators',
        289: 'del_stmt',
        290: 'dictmaker',
        291: 'dotted_as_name',
        292: 'dotted_as_names',
        293: 'dotted_name',
        294: 'encoding_decl',
        295: 'eval_input',
        296: 'except_clause',
        297: 'exec_stmt',
        298: 'file_input',
        299: 'flow_stmt',
        300: 'for_stmt',
        301: 'fpdef',
        302: 'fplist',
        303: 'funcdef',
        304: 'gen_for',
        305: 'gen_if',
        306: 'gen_iter',
        307: 'if_stmt',
        308: 'import_as_name',
        309: 'import_as_names',
        310: 'import_from',
        311: 'import_name',
        312: 'import_stmt',
        313: 'list_for',
        314: 'list_if',
        315: 'list_iter',
        316: 'listmaker',
        317: 'old_LambdaExpr',
        318: 'old_test',
        319: 'parameters',
        320: 'pass_stmt',
        321: 'print_stmt',
        322: 'raise_stmt',
        323: 'return_stmt',
        324: 'simple_stmt',
        325: 'sliceop',
        326: 'small_stmt',
        327: 'stmt',
        328: 'subscript',
        329: 'subscriptlist',
        330: 'suite',
        331: 'testlist',
        332: 'testlist1',
        333: 'testlist_gexp',
        334: 'testlist_safe',
        335: 'trailer',
        336: 'try_stmt',
        337: 'varargslist',
        338: 'while_stmt',
        339: 'with_stmt',
        340: 'with_var',
        341: 'yield_stmt' },
    dfas: {
        256: [
            [[[1, 1], [2, 1], [3, 2]], [[0, 1]], [[2, 1]]],
            {
                2: 1,
                4: 1,
                5: 1,
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                10: 1,
                11: 1,
                12: 1,
                13: 1,
                14: 1,
                15: 1,
                16: 1,
                17: 1,
                18: 1,
                19: 1,
                20: 1,
                21: 1,
                22: 1,
                23: 1,
                24: 1,
                25: 1,
                26: 1,
                27: 1,
                28: 1,
                29: 1,
                30: 1,
                31: 1,
                32: 1,
                33: 1,
                34: 1,
                35: 1,
                36: 1,
                37: 1 }],
        257: [
            [[[38, 1]], [[39, 0], [0, 1]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        258: [
            [[[40, 1]], [[25, 0], [37, 0], [0, 1]]],
            { 6: 1, 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 25: 1, 29: 1, 32: 1, 37: 1 }],
        259: [
            [
                [[21, 1], [8, 1], [9, 4], [29, 3], [32, 2], [14, 5], [18, 6]],
                [[0, 1]],
                [[41, 7], [42, 1]],
                [[43, 1], [44, 8], [45, 8]],
                [[46, 9], [47, 1]],
                [[48, 10]],
                [[18, 6], [0, 6]],
                [[42, 1]],
                [[43, 1]],
                [[47, 1]],
                [[14, 1]]],
            { 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 29: 1, 32: 1 }],
        260: [
            [[[49, 1]], [[50, 0], [0, 1]]],
            { 6: 1, 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 25: 1, 29: 1, 32: 1, 37: 1 }],
        261: [
            [[[51, 1]], [[52, 0], [0, 1]]],
            { 6: 1, 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 25: 1, 29: 1, 32: 1, 37: 1 }],
        262: [
            [[[53, 1]], [[54, 0], [0, 1]]],
            { 6: 1, 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 25: 1, 29: 1, 32: 1, 37: 1 }],
        263: [
            [[[55, 1]], [[56, 0], [0, 1]]],
            { 6: 1, 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 25: 1, 29: 1, 32: 1, 37: 1 }],
        264: [
            [[[55, 1]], [[57, 2], [0, 1]], [[55, 1], [0, 2]]],
            { 6: 1, 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 25: 1, 29: 1, 32: 1, 37: 1 }],
        265: [
            [
                [[58, 1]],
                [[59, 2], [60, 3], [0, 1]],
                [[58, 4], [45, 4]],
                [[58, 5], [45, 5]],
                [[0, 4]],
                [[60, 3], [0, 5]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        266: [
            [[[61, 1]], [[62, 0], [63, 0], [64, 0], [65, 0], [0, 1]]],
            { 6: 1, 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 25: 1, 29: 1, 32: 1, 37: 1 }],
        267: [[[[27, 1]], [[21, 2]], [[57, 1], [0, 2]]], { 27: 1 }],
        268: [
            [
                [[66, 1], [67, 2]],
                [[0, 1]],
                [[31, 3], [0, 2]],
                [[67, 4]],
                [[68, 5]],
                [[69, 1]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        269: [
            [[[11, 1]], [[70, 2], [71, 3]], [[69, 4]], [[70, 2]], [[0, 4]]],
            { 11: 1 }],
        270: [[[[13, 1]], [[21, 2]], [[57, 1], [0, 2]]], { 13: 1 }],
        271: [
            [[[7, 1], [72, 2]], [[38, 2]], [[0, 2]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        272: [
            [[[73, 1]], [[74, 0], [0, 1]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        273: [
            [[[75, 1]], [[76, 1], [77, 2], [0, 1]], [[49, 3]], [[0, 3]]],
            { 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 29: 1, 32: 1 }],
        274: [
            [[[78, 1]], [[79, 0], [80, 0], [0, 1]]],
            { 6: 1, 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 25: 1, 29: 1, 32: 1, 37: 1 }],
        275: [
            [[[25, 1], [6, 1], [37, 1], [81, 2]], [[49, 2]], [[0, 2]]],
            { 6: 1, 8: 1, 9: 1, 14: 1, 18: 1, 21: 1, 25: 1, 29: 1, 32: 1, 37: 1 }],
        276: [[[[26, 1]], [[58, 2], [0, 1]], [[0, 2]]], { 26: 1 }],
        277: [
            [
                [[63, 1], [82, 2], [77, 3]],
                [[69, 4]],
                [[57, 5], [0, 2]],
                [[69, 6]],
                [[57, 7], [0, 4]],
                [[63, 1], [82, 2], [77, 3], [0, 5]],
                [[0, 6]],
                [[82, 4], [77, 3]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1,
                63: 1,
                77: 1 }],
        278: [
            [[[69, 1]], [[83, 2], [60, 3], [0, 1]], [[0, 2]], [[69, 2]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        279: [
            [[[20, 1]], [[69, 2]], [[57, 3], [0, 2]], [[69, 4]], [[0, 4]]],
            { 20: 1 }],
        280: [
            [
                [
                    [84, 1],
                    [85, 1],
                    [86, 1],
                    [87, 1],
                    [88, 1],
                    [89, 1],
                    [90, 1],
                    [91, 1],
                    [92, 1],
                    [93, 1],
                    [94, 1],
                    [95, 1]],
                [[0, 1]]],
            {
                84: 1,
                85: 1,
                86: 1,
                87: 1,
                88: 1,
                89: 1,
                90: 1,
                91: 1,
                92: 1,
                93: 1,
                94: 1,
                95: 1 }],
        281: [[[[33, 1]], [[0, 1]]], { 33: 1 }],
        282: [
            [
                [[10, 1]],
                [[21, 2]],
                [[70, 3], [29, 4]],
                [[96, 5]],
                [[43, 6], [58, 7]],
                [[0, 5]],
                [[70, 3]],
                [[43, 6]]],
            { 10: 1 }],
        283: [
            [
                [
                    [97, 1],
                    [98, 1],
                    [7, 2],
                    [99, 1],
                    [97, 1],
                    [100, 1],
                    [101, 1],
                    [102, 3],
                    [103, 1],
                    [104, 1]],
                [[0, 1]],
                [[100, 1]],
                [[7, 1], [0, 3]]],
            { 7: 1, 97: 1, 98: 1, 99: 1, 100: 1, 101: 1, 102: 1, 103: 1, 104: 1 }],
        284: [
            [
                [
                    [105, 1],
                    [106, 1],
                    [107, 1],
                    [108, 1],
                    [109, 1],
                    [110, 1],
                    [111, 1],
                    [112, 1]],
                [[0, 1]]],
            { 4: 1, 10: 1, 15: 1, 17: 1, 28: 1, 31: 1, 35: 1, 36: 1 }],
        285: [[[[34, 1]], [[0, 1]]], { 34: 1 }],
        286: [[[[113, 1]], [[111, 2], [108, 2]], [[0, 2]]], { 35: 1 }],
        287: [
            [
                [[35, 1]],
                [[114, 2]],
                [[2, 4], [29, 3]],
                [[43, 5], [115, 6]],
                [[0, 4]],
                [[2, 4]],
                [[43, 5]]],
            { 35: 1 }],
        288: [[[[116, 1]], [[116, 1], [0, 1]]], { 35: 1 }],
        289: [[[[22, 1]], [[117, 2]], [[0, 2]]], { 22: 1 }],
        290: [
            [
                [[69, 1]],
                [[70, 2]],
                [[69, 3]],
                [[57, 4], [0, 3]],
                [[69, 1], [0, 4]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        291: [[[[114, 1]], [[118, 2], [0, 1]], [[21, 3]], [[0, 3]]], { 21: 1 }],
        292: [[[[119, 1]], [[57, 0], [0, 1]]], { 21: 1 }],
        293: [[[[21, 1]], [[120, 0], [0, 1]]], { 21: 1 }],
        294: [[[[21, 1]], [[0, 1]]], { 21: 1 }],
        295: [
            [[[58, 1]], [[2, 1], [121, 2]], [[0, 2]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        296: [
            [
                [[122, 1]],
                [[69, 2], [0, 1]],
                [[118, 3], [57, 3], [0, 2]],
                [[69, 4]],
                [[0, 4]]],
            { 122: 1 }],
        297: [
            [
                [[16, 1]],
                [[55, 2]],
                [[100, 3], [0, 2]],
                [[69, 4]],
                [[57, 5], [0, 4]],
                [[69, 6]],
                [[0, 6]]],
            { 16: 1 }],
        298: [
            [[[2, 0], [121, 1], [123, 0]], [[0, 1]]],
            {
                2: 1,
                4: 1,
                5: 1,
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                10: 1,
                11: 1,
                12: 1,
                13: 1,
                14: 1,
                15: 1,
                16: 1,
                17: 1,
                18: 1,
                19: 1,
                20: 1,
                21: 1,
                22: 1,
                23: 1,
                24: 1,
                25: 1,
                26: 1,
                27: 1,
                28: 1,
                29: 1,
                30: 1,
                31: 1,
                32: 1,
                33: 1,
                34: 1,
                35: 1,
                36: 1,
                37: 1,
                121: 1 }],
        299: [
            [[[124, 1], [125, 1], [126, 1], [127, 1], [128, 1]], [[0, 1]]],
            { 5: 1, 19: 1, 26: 1, 33: 1, 34: 1 }],
        300: [
            [
                [[28, 1]],
                [[117, 2]],
                [[100, 3]],
                [[58, 4]],
                [[70, 5]],
                [[96, 6]],
                [[68, 7], [0, 6]],
                [[70, 8]],
                [[96, 9]],
                [[0, 9]]],
            { 28: 1 }],
        301: [[[[29, 1], [21, 2]], [[129, 3]], [[0, 2]], [[43, 2]]], { 21: 1, 29: 1 }],
        302: [[[[130, 1]], [[57, 2], [0, 1]], [[130, 1], [0, 2]]], { 21: 1, 29: 1 }],
        303: [
            [[[4, 1]], [[21, 2]], [[131, 3]], [[70, 4]], [[96, 5]], [[0, 5]]],
            { 4: 1 }],
        304: [
            [
                [[28, 1]],
                [[117, 2]],
                [[100, 3]],
                [[67, 4]],
                [[132, 5], [0, 4]],
                [[0, 5]]],
            { 28: 1 }],
        305: [[[[31, 1]], [[133, 2]], [[132, 3], [0, 2]], [[0, 3]]], { 31: 1 }],
        306: [[[[83, 1], [134, 1]], [[0, 1]]], { 28: 1, 31: 1 }],
        307: [
            [
                [[31, 1]],
                [[69, 2]],
                [[70, 3]],
                [[96, 4]],
                [[68, 5], [135, 1], [0, 4]],
                [[70, 6]],
                [[96, 7]],
                [[0, 7]]],
            { 31: 1 }],
        308: [[[[21, 1]], [[118, 2], [0, 1]], [[21, 3]], [[0, 3]]], { 21: 1 }],
        309: [[[[136, 1]], [[57, 2], [0, 1]], [[136, 1], [0, 2]]], { 21: 1 }],
        310: [
            [
                [[30, 1]],
                [[114, 2], [120, 3]],
                [[24, 4]],
                [[114, 2], [24, 4], [120, 3]],
                [[137, 5], [63, 5], [29, 6]],
                [[0, 5]],
                [[137, 7]],
                [[43, 5]]],
            { 30: 1 }],
        311: [[[[24, 1]], [[138, 2]], [[0, 2]]], { 24: 1 }],
        312: [[[[139, 1], [140, 1]], [[0, 1]]], { 24: 1, 30: 1 }],
        313: [
            [
                [[28, 1]],
                [[117, 2]],
                [[100, 3]],
                [[141, 4]],
                [[142, 5], [0, 4]],
                [[0, 5]]],
            { 28: 1 }],
        314: [[[[31, 1]], [[133, 2]], [[142, 3], [0, 2]], [[0, 3]]], { 31: 1 }],
        315: [[[[143, 1], [144, 1]], [[0, 1]]], { 28: 1, 31: 1 }],
        316: [
            [
                [[69, 1]],
                [[143, 2], [57, 3], [0, 1]],
                [[0, 2]],
                [[69, 4], [0, 3]],
                [[57, 3], [0, 4]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        317: [
            [[[11, 1]], [[70, 2], [71, 3]], [[133, 4]], [[70, 2]], [[0, 4]]],
            { 11: 1 }],
        318: [
            [[[145, 1], [67, 1]], [[0, 1]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        319: [[[[29, 1]], [[43, 2], [71, 3]], [[0, 2]], [[43, 2]]], { 29: 1 }],
        320: [[[[23, 1]], [[0, 1]]], { 23: 1 }],
        321: [
            [
                [[12, 1]],
                [[69, 2], [79, 3], [0, 1]],
                [[57, 4], [0, 2]],
                [[69, 5]],
                [[69, 2], [0, 4]],
                [[57, 6], [0, 5]],
                [[69, 7]],
                [[57, 8], [0, 7]],
                [[69, 7], [0, 8]]],
            { 12: 1 }],
        322: [
            [
                [[5, 1]],
                [[69, 2], [0, 1]],
                [[57, 3], [0, 2]],
                [[69, 4]],
                [[57, 5], [0, 4]],
                [[69, 6]],
                [[0, 6]]],
            { 5: 1 }],
        323: [[[[19, 1]], [[58, 2], [0, 1]], [[0, 2]]], { 19: 1 }],
        324: [
            [[[146, 1]], [[2, 2], [147, 3]], [[0, 2]], [[146, 1], [2, 2]]],
            {
                5: 1,
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                12: 1,
                13: 1,
                14: 1,
                16: 1,
                18: 1,
                19: 1,
                20: 1,
                21: 1,
                22: 1,
                23: 1,
                24: 1,
                25: 1,
                26: 1,
                27: 1,
                29: 1,
                30: 1,
                32: 1,
                33: 1,
                34: 1,
                37: 1 }],
        325: [[[[70, 1]], [[69, 2], [0, 1]], [[0, 2]]], { 70: 1 }],
        326: [
            [
                [
                    [148, 1],
                    [149, 1],
                    [150, 1],
                    [151, 1],
                    [152, 1],
                    [153, 1],
                    [154, 1],
                    [155, 1],
                    [156, 1],
                    [157, 1]],
                [[0, 1]]],
            {
                5: 1,
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                12: 1,
                13: 1,
                14: 1,
                16: 1,
                18: 1,
                19: 1,
                20: 1,
                21: 1,
                22: 1,
                23: 1,
                24: 1,
                25: 1,
                26: 1,
                27: 1,
                29: 1,
                30: 1,
                32: 1,
                33: 1,
                34: 1,
                37: 1 }],
        327: [
            [[[1, 1], [3, 1]], [[0, 1]]],
            {
                4: 1,
                5: 1,
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                10: 1,
                11: 1,
                12: 1,
                13: 1,
                14: 1,
                15: 1,
                16: 1,
                17: 1,
                18: 1,
                19: 1,
                20: 1,
                21: 1,
                22: 1,
                23: 1,
                24: 1,
                25: 1,
                26: 1,
                27: 1,
                28: 1,
                29: 1,
                30: 1,
                31: 1,
                32: 1,
                33: 1,
                34: 1,
                35: 1,
                36: 1,
                37: 1 }],
        328: [
            [
                [[70, 1], [69, 2], [120, 3]],
                [[158, 4], [69, 5], [0, 1]],
                [[70, 1], [0, 2]],
                [[120, 6]],
                [[0, 4]],
                [[158, 4], [0, 5]],
                [[120, 4]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1,
                70: 1,
                120: 1 }],
        329: [
            [[[159, 1]], [[57, 2], [0, 1]], [[159, 1], [0, 2]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1,
                70: 1,
                120: 1 }],
        330: [
            [
                [[1, 1], [2, 2]],
                [[0, 1]],
                [[160, 3]],
                [[123, 4]],
                [[161, 1], [123, 4]]],
            {
                2: 1,
                5: 1,
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                12: 1,
                13: 1,
                14: 1,
                16: 1,
                18: 1,
                19: 1,
                20: 1,
                21: 1,
                22: 1,
                23: 1,
                24: 1,
                25: 1,
                26: 1,
                27: 1,
                29: 1,
                30: 1,
                32: 1,
                33: 1,
                34: 1,
                37: 1 }],
        331: [
            [[[69, 1]], [[57, 2], [0, 1]], [[69, 1], [0, 2]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        332: [
            [[[69, 1]], [[57, 0], [0, 1]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        333: [
            [
                [[69, 1]],
                [[83, 2], [57, 3], [0, 1]],
                [[0, 2]],
                [[69, 4], [0, 3]],
                [[57, 3], [0, 4]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        334: [
            [
                [[133, 1]],
                [[57, 2], [0, 1]],
                [[133, 3]],
                [[57, 4], [0, 3]],
                [[133, 3], [0, 4]]],
            {
                6: 1,
                7: 1,
                8: 1,
                9: 1,
                11: 1,
                14: 1,
                18: 1,
                21: 1,
                25: 1,
                29: 1,
                32: 1,
                37: 1 }],
        335: [
            [
                [[29, 1], [120, 2], [32, 3]],
                [[43, 4], [115, 5]],
                [[21, 4]],
                [[162, 6]],
                [[0, 4]],
                [[43, 4]],
                [[42, 4]]],
            { 29: 1, 32: 1, 120: 1 }],
        336: [
            [
                [[15, 1]],
                [[70, 2]],
                [[96, 3]],
                [[163, 4], [164, 5]],
                [[70, 6]],
                [[70, 7]],
                [[96, 8]],
                [[96, 9]],
                [[163, 4], [68, 10], [164, 5], [0, 8]],
                [[0, 9]],
                [[70, 11]],
                [[96, 12]],
                [[164, 5], [0, 12]]],
            { 15: 1 }],
        337: [
            [
                [[63, 1], [130, 2], [77, 3]],
                [[21, 4]],
                [[60, 5], [57, 6], [0, 2]],
                [[21, 7]],
                [[57, 8], [0, 4]],
                [[69, 9]],
                [[63, 1], [130, 2], [77, 3], [0, 6]],
                [[0, 7]],
                [[77, 3]],
                [[57, 6], [0, 9]]],
            { 21: 1, 29: 1, 63: 1, 77: 1 }],
        338: [
            [
                [[17, 1]],
                [[69, 2]],
                [[70, 3]],
                [[96, 4]],
                [[68, 5], [0, 4]],
                [[70, 6]],
                [[96, 7]],
                [[0, 7]]],
            { 17: 1 }],
        339: [
            [
                [[36, 1]],
                [[69, 2]],
                [[70, 3], [165, 4]],
                [[96, 5]],
                [[70, 3]],
                [[0, 5]]],
            { 36: 1 }],
        340: [[[[118, 1]], [[55, 2]], [[0, 2]]], { 118: 1 }],
        341: [[[[45, 1]], [[0, 1]]], { 26: 1 }] },
    states: [
        [[[1, 1], [2, 1], [3, 2]], [[0, 1]], [[2, 1]]],
        [[[38, 1]], [[39, 0], [0, 1]]],
        [[[40, 1]], [[25, 0], [37, 0], [0, 1]]],
        [
            [[21, 1], [8, 1], [9, 4], [29, 3], [32, 2], [14, 5], [18, 6]],
            [[0, 1]],
            [[41, 7], [42, 1]],
            [[43, 1], [44, 8], [45, 8]],
            [[46, 9], [47, 1]],
            [[48, 10]],
            [[18, 6], [0, 6]],
            [[42, 1]],
            [[43, 1]],
            [[47, 1]],
            [[14, 1]]],
        [[[49, 1]], [[50, 0], [0, 1]]],
        [[[51, 1]], [[52, 0], [0, 1]]],
        [[[53, 1]], [[54, 0], [0, 1]]],
        [[[55, 1]], [[56, 0], [0, 1]]],
        [[[55, 1]], [[57, 2], [0, 1]], [[55, 1], [0, 2]]],
        [
            [[58, 1]],
            [[59, 2], [60, 3], [0, 1]],
            [[58, 4], [45, 4]],
            [[58, 5], [45, 5]],
            [[0, 4]],
            [[60, 3], [0, 5]]],
        [[[61, 1]], [[62, 0], [63, 0], [64, 0], [65, 0], [0, 1]]],
        [[[27, 1]], [[21, 2]], [[57, 1], [0, 2]]],
        [
            [[66, 1], [67, 2]],
            [[0, 1]],
            [[31, 3], [0, 2]],
            [[67, 4]],
            [[68, 5]],
            [[69, 1]]],
        [[[11, 1]], [[70, 2], [71, 3]], [[69, 4]], [[70, 2]], [[0, 4]]],
        [[[13, 1]], [[21, 2]], [[57, 1], [0, 2]]],
        [[[7, 1], [72, 2]], [[38, 2]], [[0, 2]]],
        [[[73, 1]], [[74, 0], [0, 1]]],
        [[[75, 1]], [[76, 1], [77, 2], [0, 1]], [[49, 3]], [[0, 3]]],
        [[[78, 1]], [[79, 0], [80, 0], [0, 1]]],
        [[[25, 1], [6, 1], [37, 1], [81, 2]], [[49, 2]], [[0, 2]]],
        [[[26, 1]], [[58, 2], [0, 1]], [[0, 2]]],
        [
            [[63, 1], [82, 2], [77, 3]],
            [[69, 4]],
            [[57, 5], [0, 2]],
            [[69, 6]],
            [[57, 7], [0, 4]],
            [[63, 1], [82, 2], [77, 3], [0, 5]],
            [[0, 6]],
            [[82, 4], [77, 3]]],
        [[[69, 1]], [[83, 2], [60, 3], [0, 1]], [[0, 2]], [[69, 2]]],
        [[[20, 1]], [[69, 2]], [[57, 3], [0, 2]], [[69, 4]], [[0, 4]]],
        [
            [
                [84, 1],
                [85, 1],
                [86, 1],
                [87, 1],
                [88, 1],
                [89, 1],
                [90, 1],
                [91, 1],
                [92, 1],
                [93, 1],
                [94, 1],
                [95, 1]],
            [[0, 1]]],
        [[[33, 1]], [[0, 1]]],
        [
            [[10, 1]],
            [[21, 2]],
            [[70, 3], [29, 4]],
            [[96, 5]],
            [[43, 6], [58, 7]],
            [[0, 5]],
            [[70, 3]],
            [[43, 6]]],
        [
            [
                [97, 1],
                [98, 1],
                [7, 2],
                [99, 1],
                [97, 1],
                [100, 1],
                [101, 1],
                [102, 3],
                [103, 1],
                [104, 1]],
            [[0, 1]],
            [[100, 1]],
            [[7, 1], [0, 3]]],
        [
            [
                [105, 1],
                [106, 1],
                [107, 1],
                [108, 1],
                [109, 1],
                [110, 1],
                [111, 1],
                [112, 1]],
            [[0, 1]]],
        [[[34, 1]], [[0, 1]]],
        [[[113, 1]], [[111, 2], [108, 2]], [[0, 2]]],
        [
            [[35, 1]],
            [[114, 2]],
            [[2, 4], [29, 3]],
            [[43, 5], [115, 6]],
            [[0, 4]],
            [[2, 4]],
            [[43, 5]]],
        [[[116, 1]], [[116, 1], [0, 1]]],
        [[[22, 1]], [[117, 2]], [[0, 2]]],
        [[[69, 1]], [[70, 2]], [[69, 3]], [[57, 4], [0, 3]], [[69, 1], [0, 4]]],
        [[[114, 1]], [[118, 2], [0, 1]], [[21, 3]], [[0, 3]]],
        [[[119, 1]], [[57, 0], [0, 1]]],
        [[[21, 1]], [[120, 0], [0, 1]]],
        [[[21, 1]], [[0, 1]]],
        [[[58, 1]], [[2, 1], [121, 2]], [[0, 2]]],
        [
            [[122, 1]],
            [[69, 2], [0, 1]],
            [[118, 3], [57, 3], [0, 2]],
            [[69, 4]],
            [[0, 4]]],
        [
            [[16, 1]],
            [[55, 2]],
            [[100, 3], [0, 2]],
            [[69, 4]],
            [[57, 5], [0, 4]],
            [[69, 6]],
            [[0, 6]]],
        [[[2, 0], [121, 1], [123, 0]], [[0, 1]]],
        [[[124, 1], [125, 1], [126, 1], [127, 1], [128, 1]], [[0, 1]]],
        [
            [[28, 1]],
            [[117, 2]],
            [[100, 3]],
            [[58, 4]],
            [[70, 5]],
            [[96, 6]],
            [[68, 7], [0, 6]],
            [[70, 8]],
            [[96, 9]],
            [[0, 9]]],
        [[[29, 1], [21, 2]], [[129, 3]], [[0, 2]], [[43, 2]]],
        [[[130, 1]], [[57, 2], [0, 1]], [[130, 1], [0, 2]]],
        [[[4, 1]], [[21, 2]], [[131, 3]], [[70, 4]], [[96, 5]], [[0, 5]]],
        [[[28, 1]], [[117, 2]], [[100, 3]], [[67, 4]], [[132, 5], [0, 4]], [[0, 5]]],
        [[[31, 1]], [[133, 2]], [[132, 3], [0, 2]], [[0, 3]]],
        [[[83, 1], [134, 1]], [[0, 1]]],
        [
            [[31, 1]],
            [[69, 2]],
            [[70, 3]],
            [[96, 4]],
            [[68, 5], [135, 1], [0, 4]],
            [[70, 6]],
            [[96, 7]],
            [[0, 7]]],
        [[[21, 1]], [[118, 2], [0, 1]], [[21, 3]], [[0, 3]]],
        [[[136, 1]], [[57, 2], [0, 1]], [[136, 1], [0, 2]]],
        [
            [[30, 1]],
            [[114, 2], [120, 3]],
            [[24, 4]],
            [[114, 2], [24, 4], [120, 3]],
            [[137, 5], [63, 5], [29, 6]],
            [[0, 5]],
            [[137, 7]],
            [[43, 5]]],
        [[[24, 1]], [[138, 2]], [[0, 2]]],
        [[[139, 1], [140, 1]], [[0, 1]]],
        [[[28, 1]], [[117, 2]], [[100, 3]], [[141, 4]], [[142, 5], [0, 4]], [[0, 5]]],
        [[[31, 1]], [[133, 2]], [[142, 3], [0, 2]], [[0, 3]]],
        [[[143, 1], [144, 1]], [[0, 1]]],
        [
            [[69, 1]],
            [[143, 2], [57, 3], [0, 1]],
            [[0, 2]],
            [[69, 4], [0, 3]],
            [[57, 3], [0, 4]]],
        [[[11, 1]], [[70, 2], [71, 3]], [[133, 4]], [[70, 2]], [[0, 4]]],
        [[[145, 1], [67, 1]], [[0, 1]]],
        [[[29, 1]], [[43, 2], [71, 3]], [[0, 2]], [[43, 2]]],
        [[[23, 1]], [[0, 1]]],
        [
            [[12, 1]],
            [[69, 2], [79, 3], [0, 1]],
            [[57, 4], [0, 2]],
            [[69, 5]],
            [[69, 2], [0, 4]],
            [[57, 6], [0, 5]],
            [[69, 7]],
            [[57, 8], [0, 7]],
            [[69, 7], [0, 8]]],
        [
            [[5, 1]],
            [[69, 2], [0, 1]],
            [[57, 3], [0, 2]],
            [[69, 4]],
            [[57, 5], [0, 4]],
            [[69, 6]],
            [[0, 6]]],
        [[[19, 1]], [[58, 2], [0, 1]], [[0, 2]]],
        [[[146, 1]], [[2, 2], [147, 3]], [[0, 2]], [[146, 1], [2, 2]]],
        [[[70, 1]], [[69, 2], [0, 1]], [[0, 2]]],
        [
            [
                [148, 1],
                [149, 1],
                [150, 1],
                [151, 1],
                [152, 1],
                [153, 1],
                [154, 1],
                [155, 1],
                [156, 1],
                [157, 1]],
            [[0, 1]]],
        [[[1, 1], [3, 1]], [[0, 1]]],
        [
            [[70, 1], [69, 2], [120, 3]],
            [[158, 4], [69, 5], [0, 1]],
            [[70, 1], [0, 2]],
            [[120, 6]],
            [[0, 4]],
            [[158, 4], [0, 5]],
            [[120, 4]]],
        [[[159, 1]], [[57, 2], [0, 1]], [[159, 1], [0, 2]]],
        [[[1, 1], [2, 2]], [[0, 1]], [[160, 3]], [[123, 4]], [[161, 1], [123, 4]]],
        [[[69, 1]], [[57, 2], [0, 1]], [[69, 1], [0, 2]]],
        [[[69, 1]], [[57, 0], [0, 1]]],
        [
            [[69, 1]],
            [[83, 2], [57, 3], [0, 1]],
            [[0, 2]],
            [[69, 4], [0, 3]],
            [[57, 3], [0, 4]]],
        [
            [[133, 1]],
            [[57, 2], [0, 1]],
            [[133, 3]],
            [[57, 4], [0, 3]],
            [[133, 3], [0, 4]]],
        [
            [[29, 1], [120, 2], [32, 3]],
            [[43, 4], [115, 5]],
            [[21, 4]],
            [[162, 6]],
            [[0, 4]],
            [[43, 4]],
            [[42, 4]]],
        [
            [[15, 1]],
            [[70, 2]],
            [[96, 3]],
            [[163, 4], [164, 5]],
            [[70, 6]],
            [[70, 7]],
            [[96, 8]],
            [[96, 9]],
            [[163, 4], [68, 10], [164, 5], [0, 8]],
            [[0, 9]],
            [[70, 11]],
            [[96, 12]],
            [[164, 5], [0, 12]]],
        [
            [[63, 1], [130, 2], [77, 3]],
            [[21, 4]],
            [[60, 5], [57, 6], [0, 2]],
            [[21, 7]],
            [[57, 8], [0, 4]],
            [[69, 9]],
            [[63, 1], [130, 2], [77, 3], [0, 6]],
            [[0, 7]],
            [[77, 3]],
            [[57, 6], [0, 9]]],
        [
            [[17, 1]],
            [[69, 2]],
            [[70, 3]],
            [[96, 4]],
            [[68, 5], [0, 4]],
            [[70, 6]],
            [[96, 7]],
            [[0, 7]]],
        [[[36, 1]], [[69, 2]], [[70, 3], [165, 4]], [[96, 5]], [[70, 3]], [[0, 5]]],
        [[[118, 1]], [[55, 2]], [[0, 2]]],
        [[[45, 1]], [[0, 1]]]],
    labels: [
        [0, 'EMPTY'],
        [324, null],
        [4, null],
        [284, null],
        [1, 'def'],
        [1, 'raise'],
        [32, null],
        [1, 'not'],
        [2, null],
        [26, null],
        [1, 'class'],
        [1, 'lambda'],
        [1, 'print'],
        [1, 'nonlocal'],
        [25, null],
        [1, 'try'],
        [1, 'exec'],
        [1, 'while'],
        [3, null],
        [1, 'return'],
        [1, 'assert'],
        [1, null],
        [1, 'del'],
        [1, 'pass'],
        [1, 'import'],
        [15, null],
        [1, 'yield'],
        [1, 'global'],
        [1, 'for'],
        [7, null],
        [1, 'from'],
        [1, 'if'],
        [9, null],
        [1, 'break'],
        [1, 'continue'],
        [50, null],
        [1, 'with'],
        [14, null],
        [271, null],
        [1, 'and'],
        [266, null],
        [316, null],
        [10, null],
        [8, null],
        [333, null],
        [276, null],
        [290, null],
        [27, null],
        [332, null],
        [275, null],
        [19, null],
        [262, null],
        [18, null],
        [260, null],
        [33, null],
        [258, null],
        [283, null],
        [12, null],
        [331, null],
        [280, null],
        [22, null],
        [274, null],
        [48, null],
        [16, null],
        [17, null],
        [24, null],
        [269, null],
        [272, null],
        [1, 'else'],
        [268, null],
        [11, null],
        [337, null],
        [263, null],
        [257, null],
        [1, 'or'],
        [259, null],
        [335, null],
        [36, null],
        [261, null],
        [35, null],
        [34, null],
        [273, null],
        [278, null],
        [304, null],
        [46, null],
        [39, null],
        [41, null],
        [47, null],
        [42, null],
        [43, null],
        [37, null],
        [44, null],
        [49, null],
        [45, null],
        [38, null],
        [40, null],
        [330, null],
        [29, null],
        [21, null],
        [28, null],
        [1, 'in'],
        [30, null],
        [1, 'is'],
        [31, null],
        [20, null],
        [336, null],
        [307, null],
        [300, null],
        [282, null],
        [339, null],
        [338, null],
        [303, null],
        [286, null],
        [288, null],
        [293, null],
        [277, null],
        [287, null],
        [264, null],
        [1, 'as'],
        [291, null],
        [23, null],
        [0, null],
        [1, 'except'],
        [327, null],
        [281, null],
        [285, null],
        [322, null],
        [323, null],
        [341, null],
        [302, null],
        [301, null],
        [319, null],
        [306, null],
        [318, null],
        [305, null],
        [1, 'elif'],
        [308, null],
        [309, null],
        [292, null],
        [311, null],
        [310, null],
        [334, null],
        [315, null],
        [313, null],
        [314, null],
        [317, null],
        [326, null],
        [13, null],
        [270, null],
        [267, null],
        [265, null],
        [320, null],
        [321, null],
        [289, null],
        [297, null],
        [299, null],
        [279, null],
        [312, null],
        [325, null],
        [328, null],
        [5, null],
        [6, null],
        [329, null],
        [296, null],
        [1, 'finally'],
        [340, null]],
    keywords: {
        'and': 39,
        'as': 118,
        'assert': 20,
        'break': 33,
        'class': 10,
        'continue': 34,
        'def': 4,
        'del': 22,
        'elif': 135,
        'else': 68,
        'except': 122,
        'exec': 16,
        'finally': 164,
        'for': 28,
        'from': 30,
        'global': 27,
        'if': 31,
        'import': 24,
        'in': 100,
        'is': 102,
        'lambda': 11,
        'nonlocal': 13,
        'not': 7,
        'or': 74,
        'pass': 23,
        'print': 12,
        'raise': 5,
        'return': 19,
        'try': 15,
        'while': 17,
        'with': 36,
        'yield': 26 },
    tokens: {
        0: 121,
        1: 21,
        2: 8,
        3: 18,
        4: 2,
        5: 160,
        6: 161,
        7: 29,
        8: 43,
        9: 32,
        10: 42,
        11: 70,
        12: 57,
        13: 147,
        14: 37,
        15: 25,
        16: 63,
        17: 64,
        18: 52,
        19: 50,
        20: 104,
        21: 98,
        22: 60,
        23: 120,
        24: 65,
        25: 14,
        26: 9,
        27: 47,
        28: 99,
        29: 97,
        30: 101,
        31: 103,
        32: 6,
        33: 54,
        34: 80,
        35: 79,
        36: 77,
        37: 90,
        38: 94,
        39: 85,
        40: 95,
        41: 86,
        42: 88,
        43: 89,
        44: 91,
        45: 93,
        46: 84,
        47: 87,
        48: 62,
        49: 92,
        50: 35 },
    start: 256
};
});

ace.define("ace/mode/python/Parser",["require","exports","module","ace/mode/python/asserts","ace/mode/python/base","ace/mode/python/tables","ace/mode/python/Tokenizer"], function(require, exports, module) {
"no use strict";
var asserts = require('./asserts');
var base = require('./base');
var tables = require('./tables');
var Tokenizer = require('./Tokenizer');

var OpMap = tables.OpMap;
var ParseTables = tables.ParseTables;
function parseError(message, fileName, begin, end) {
    var e = new SyntaxError(message);
    e.name = "ParseError";
    e['fileName'] = fileName;
    if (base.isDef(begin)) {
        e['lineNumber'] = begin[0];
        e['columnNumber'] = begin[1];
    }
    return e;
}
function findInDfa(a, obj) {
    var i = a.length;
    while (i--) {
        if (a[i][0] === obj[0] && a[i][1] === obj[1]) {
            return true;
        }
    }
    return false;
}

var Node = (function () {
    function Node(type, value, lineno, col_offset, children) {
        this.used_names = {};
        this.type = type;
        this.value = value;
        this.lineno = lineno;
        this.col_offset = col_offset;
        this.children = children;
    }
    return Node;
})();
exports.Node = Node;

var StackEntry = (function () {
    function StackEntry(dfa, state, node) {
        this.dfa = dfa;
        this.state = state;
        this.node = node;
    }
    return StackEntry;
})();

var Parser = (function () {
    function Parser(fileName, grammar) {
        this.fileName = fileName;
        this.grammar = grammar;
    }
    Parser.prototype.setup = function (start) {
        start = start || this.grammar.start;
        var newnode = new Node(start, null, null, null, []);
        this.stack = [new StackEntry(this.grammar.dfas[start], 0, newnode)];
        this.used_names = {};
    };
    Parser.prototype.addtoken = function (type, value, context) {
        var iLabel = this.classify(type, value, context);

        OUTERWHILE:
        while (true) {
            var tp = this.stack[this.stack.length - 1];
            var states = tp.dfa[0];
            var first = tp.dfa[1];
            var arcs = states[tp.state];

            for (var a = 0; a < arcs.length; ++a) {
                var i = arcs[a][0];
                var newstate = arcs[a][1];
                var t = this.grammar.labels[i][0];
                var v = this.grammar.labels[i][1];
                if (iLabel === i) {
                    asserts.assert(t < 256);
                    this.shift(type, value, newstate, context);
                    var state = newstate;
                    while (states[state].length === 1 && states[state][0][0] === 0 && states[state][0][1] === state) {
                        this.pop();
                        if (this.stack.length === 0) {
                            return true;
                        }
                        tp = this.stack[this.stack.length - 1];
                        state = tp.state;
                        states = tp.dfa[0];
                        first = tp.dfa[1];
                    }
                    return false;
                } else if (t >= 256) {
                    var itsdfa = this.grammar.dfas[t];
                    var itsfirst = itsdfa[1];
                    if (itsfirst.hasOwnProperty(iLabel)) {
                        this.push(t, this.grammar.dfas[t], newstate, context);
                        continue OUTERWHILE;
                    }
                }
            }

            if (findInDfa(arcs, [0, tp.state])) {
                this.pop();
                if (this.stack.length === 0) {
                    throw parseError("too much input", this.fileName);
                }
            } else {
                throw parseError("Invalid Syntax", this.fileName, context[0], context[1]);
            }
        }
    };
    Parser.prototype.classify = function (type, value, context) {
        var iLabel;
        if (type === Tokenizer.Tokens.T_NAME) {
            this.used_names[value] = true;
            iLabel = this.grammar.keywords.hasOwnProperty(value) && this.grammar.keywords[value];
            if (iLabel) {
                return iLabel;
            }
        }
        iLabel = this.grammar.tokens.hasOwnProperty(type) && this.grammar.tokens[type];
        if (!iLabel) {
            throw parseError("bad token", this.fileName, context[0], context[1]);
        }
        return iLabel;
    };
    Parser.prototype.shift = function (type, value, newstate, context) {
        var dfa = this.stack[this.stack.length - 1].dfa;
        var state = this.stack[this.stack.length - 1].state;
        var node = this.stack[this.stack.length - 1].node;
        var newnode = new Node(type, value, context[0][0], context[0][1], []);
        if (newnode) {
            node.children.push(newnode);
        }
        this.stack[this.stack.length - 1] = { dfa: dfa, state: newstate, node: node };
    };
    Parser.prototype.push = function (type, newdfa, newstate, context) {
        var dfa = this.stack[this.stack.length - 1].dfa;
        var node = this.stack[this.stack.length - 1].node;

        this.stack[this.stack.length - 1] = { dfa: dfa, state: newstate, node: node };

        var newnode = new Node(type, null, context[0][0], context[0][1], []);

        this.stack.push({ dfa: newdfa, state: 0, node: newnode });
    };
    Parser.prototype.pop = function () {
        var pop = this.stack.pop();
        var newnode = pop.node;
        if (newnode) {
            if (this.stack.length !== 0) {
                var node = this.stack[this.stack.length - 1].node;
                node.children.push(newnode);
            } else {
                this.rootnode = newnode;
                this.rootnode.used_names = this.used_names;
            }
        }
    };
    return Parser;
})();
function makeParser(fileName, style) {
    if (style === undefined)
        style = "file_input";

    var p = new Parser(fileName, ParseTables);
    if (style === "file_input") {
        p.setup(ParseTables.sym.file_input);
    } else {
        asserts.fail("todo;");
    }
    var curIndex = 0;
    var lineno = 1;
    var column = 0;
    var prefix = "";
    var T_COMMENT = Tokenizer.Tokens.T_COMMENT;
    var T_NL = Tokenizer.Tokens.T_NL;
    var T_OP = Tokenizer.Tokens.T_OP;
    var tokenizer = new Tokenizer(fileName, style === "single_input", function (type, value, start, end, line) {
        var s_lineno = start[0];
        var s_column = start[1];
        if (type === T_COMMENT || type === T_NL) {
            prefix += value;
            lineno = end[0];
            column = end[1];
            if (value[value.length - 1] === "\n") {
                lineno += 1;
                column = 0;
            }
            return undefined;
        }
        if (type === T_OP) {
            type = OpMap[value];
        }
        if (p.addtoken(type, value, [start, end, line])) {
            return true;
        }
    });
    return function (line) {
        var ret = tokenizer.generateTokens(line);
        if (ret) {
            if (ret !== "done") {
                throw parseError("incomplete input", this.fileName);
            }
            return p.rootnode;
        }
        return null;
    };
}
function parse(fileName, source) {
    var parseFunc = makeParser(fileName);
    if (source.substr(source.length - 1, 1) !== "\n")
        source += "\n";
    var lines = source.split("\n");
    var ret;
    for (var i = 0; i < lines.length; ++i) {
        ret = parseFunc(lines[i] + ((i === lines.length - 1) ? "" : "\n"));
    }
    return ret;
}
exports.parse = parse;
function parseTreeDump(node) {
    var ret = "";
    if (node.type >= 256) {
        ret += ParseTables.number2symbol[node.type] + "\n";
        for (var i = 0; i < node.children.length; ++i) {
            ret += exports.parseTreeDump(node.children[i]);
        }
    } else {
        ret += Tokenizer.tokenNames[node.type] + ": " + node.value + "\n";
    }
    return ret;
}
exports.parseTreeDump = parseTreeDump;
});

ace.define("ace/mode/python/astnodes",["require","exports","module"], function(require, exports, module) {
"no use strict";
var Load = (function () {
    function Load() {
    }
    return Load;
})();
exports.Load = Load;
var Store = (function () {
    function Store() {
    }
    return Store;
})();
exports.Store = Store;
var Del = (function () {
    function Del() {
    }
    return Del;
})();
exports.Del = Del;
var AugLoad = (function () {
    function AugLoad() {
    }
    return AugLoad;
})();
exports.AugLoad = AugLoad;
var AugStore = (function () {
    function AugStore() {
    }
    return AugStore;
})();
exports.AugStore = AugStore;
var Param = (function () {
    function Param() {
    }
    return Param;
})();
exports.Param = Param;

var And = (function () {
    function And() {
    }
    return And;
})();
exports.And = And;
var Or = (function () {
    function Or() {
    }
    return Or;
})();
exports.Or = Or;

var Add = (function () {
    function Add() {
    }
    return Add;
})();
exports.Add = Add;
var Sub = (function () {
    function Sub() {
    }
    return Sub;
})();
exports.Sub = Sub;
var Mult = (function () {
    function Mult() {
    }
    return Mult;
})();
exports.Mult = Mult;
var Div = (function () {
    function Div() {
    }
    return Div;
})();
exports.Div = Div;
var Mod = (function () {
    function Mod() {
    }
    return Mod;
})();
exports.Mod = Mod;
var Pow = (function () {
    function Pow() {
    }
    return Pow;
})();
exports.Pow = Pow;
var LShift = (function () {
    function LShift() {
    }
    return LShift;
})();
exports.LShift = LShift;
var RShift = (function () {
    function RShift() {
    }
    return RShift;
})();
exports.RShift = RShift;
var BitOr = (function () {
    function BitOr() {
    }
    return BitOr;
})();
exports.BitOr = BitOr;
var BitXor = (function () {
    function BitXor() {
    }
    return BitXor;
})();
exports.BitXor = BitXor;
var BitAnd = (function () {
    function BitAnd() {
    }
    return BitAnd;
})();
exports.BitAnd = BitAnd;
var FloorDiv = (function () {
    function FloorDiv() {
    }
    return FloorDiv;
})();
exports.FloorDiv = FloorDiv;

var Invert = (function () {
    function Invert() {
    }
    return Invert;
})();
exports.Invert = Invert;
var Not = (function () {
    function Not() {
    }
    return Not;
})();
exports.Not = Not;
var UAdd = (function () {
    function UAdd() {
    }
    return UAdd;
})();
exports.UAdd = UAdd;
var USub = (function () {
    function USub() {
    }
    return USub;
})();
exports.USub = USub;

var Eq = (function () {
    function Eq() {
    }
    return Eq;
})();
exports.Eq = Eq;
var NotEq = (function () {
    function NotEq() {
    }
    return NotEq;
})();
exports.NotEq = NotEq;
var Lt = (function () {
    function Lt() {
    }
    return Lt;
})();
exports.Lt = Lt;
var LtE = (function () {
    function LtE() {
    }
    return LtE;
})();
exports.LtE = LtE;
var Gt = (function () {
    function Gt() {
    }
    return Gt;
})();
exports.Gt = Gt;
var GtE = (function () {
    function GtE() {
    }
    return GtE;
})();
exports.GtE = GtE;
var Is = (function () {
    function Is() {
    }
    return Is;
})();
exports.Is = Is;
var IsNot = (function () {
    function IsNot() {
    }
    return IsNot;
})();
exports.IsNot = IsNot;
var In_ = (function () {
    function In_() {
    }
    return In_;
})();
exports.In_ = In_;
var NotIn = (function () {
    function NotIn() {
    }
    return NotIn;
})();
exports.NotIn = NotIn;
var Module = (function () {
    function Module(body) {
        this.body = body;
    }
    return Module;
})();
exports.Module = Module;

var Interactive = (function () {
    function Interactive(body) {
        this.body = body;
    }
    return Interactive;
})();
exports.Interactive = Interactive;

var Expression = (function () {
    function Expression(body) {
        this.body = body;
    }
    return Expression;
})();
exports.Expression = Expression;

var Suite = (function () {
    function Suite(body) {
        this.body = body;
    }
    return Suite;
})();
exports.Suite = Suite;

var FunctionDef = (function () {
    function FunctionDef(name, args, body, decorator_list, lineno, col_offset) {
        this.name = name;
        this.args = args;
        this.body = body;
        this.decorator_list = decorator_list;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return FunctionDef;
})();
exports.FunctionDef = FunctionDef;

var ClassDef = (function () {
    function ClassDef(name, bases, body, decorator_list, lineno, col_offset) {
        this.name = name;
        this.bases = bases;
        this.body = body;
        this.decorator_list = decorator_list;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return ClassDef;
})();
exports.ClassDef = ClassDef;

var Return_ = (function () {
    function Return_(value, lineno, col_offset) {
        this.value = value;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Return_;
})();
exports.Return_ = Return_;

var Delete_ = (function () {
    function Delete_(targets, lineno, col_offset) {
        this.targets = targets;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Delete_;
})();
exports.Delete_ = Delete_;

var Assign = (function () {
    function Assign(targets, value, lineno, col_offset) {
        this.targets = targets;
        this.value = value;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Assign;
})();
exports.Assign = Assign;

var AugAssign = (function () {
    function AugAssign(target, op, value, lineno, col_offset) {
        this.target = target;
        this.op = op;
        this.value = value;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return AugAssign;
})();
exports.AugAssign = AugAssign;

var Print = (function () {
    function Print(dest, values, nl, lineno, col_offset) {
        this.dest = dest;
        this.values = values;
        this.nl = nl;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Print;
})();
exports.Print = Print;

var For_ = (function () {
    function For_(target, iter, body, orelse, lineno, col_offset) {
        this.target = target;
        this.iter = iter;
        this.body = body;
        this.orelse = orelse;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return For_;
})();
exports.For_ = For_;

var While_ = (function () {
    function While_(test, body, orelse, lineno, col_offset) {
        this.test = test;
        this.body = body;
        this.orelse = orelse;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return While_;
})();
exports.While_ = While_;

var If_ = (function () {
    function If_(test, body, orelse, lineno, col_offset) {
        this.test = test;
        this.body = body;
        this.orelse = orelse;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return If_;
})();
exports.If_ = If_;

var With_ = (function () {
    function With_(context_expr, optional_vars, body, lineno, col_offset) {
        this.context_expr = context_expr;
        this.optional_vars = optional_vars;
        this.body = body;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return With_;
})();
exports.With_ = With_;

var Raise = (function () {
    function Raise(type, inst, tback, lineno, col_offset) {
        this.type = type;
        this.inst = inst;
        this.tback = tback;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Raise;
})();
exports.Raise = Raise;

var TryExcept = (function () {
    function TryExcept(body, handlers, orelse, lineno, col_offset) {
        this.body = body;
        this.handlers = handlers;
        this.orelse = orelse;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return TryExcept;
})();
exports.TryExcept = TryExcept;

var TryFinally = (function () {
    function TryFinally(body, finalbody, lineno, col_offset) {
        this.body = body;
        this.finalbody = finalbody;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return TryFinally;
})();
exports.TryFinally = TryFinally;

var Assert = (function () {
    function Assert(test, msg, lineno, col_offset) {
        this.test = test;
        this.msg = msg;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Assert;
})();
exports.Assert = Assert;

var Import_ = (function () {
    function Import_(names, lineno, col_offset) {
        this.names = names;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Import_;
})();
exports.Import_ = Import_;

var ImportFrom = (function () {
    function ImportFrom(module, names, level, lineno, col_offset) {
        this.module = module;
        this.names = names;
        this.level = level;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return ImportFrom;
})();
exports.ImportFrom = ImportFrom;

var Exec = (function () {
    function Exec(body, globals, locals, lineno, col_offset) {
        this.body = body;
        this.globals = globals;
        this.locals = locals;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Exec;
})();
exports.Exec = Exec;

var Global = (function () {
    function Global(names, lineno, col_offset) {
        this.names = names;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Global;
})();
exports.Global = Global;

var NonLocal = (function () {
    function NonLocal(names, lineno, col_offset) {
        this.names = names;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return NonLocal;
})();
exports.NonLocal = NonLocal;

var Expr = (function () {
    function Expr(value, lineno, col_offset) {
        this.value = value;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Expr;
})();
exports.Expr = Expr;

var Pass = (function () {
    function Pass(lineno, col_offset) {
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Pass;
})();
exports.Pass = Pass;

var Break_ = (function () {
    function Break_(lineno, col_offset) {
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Break_;
})();
exports.Break_ = Break_;

var Continue_ = (function () {
    function Continue_(lineno, col_offset) {
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Continue_;
})();
exports.Continue_ = Continue_;

var BoolOp = (function () {
    function BoolOp(op, values, lineno, col_offset) {
        this.op = op;
        this.values = values;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return BoolOp;
})();
exports.BoolOp = BoolOp;

var BinOp = (function () {
    function BinOp(left, op, right, lineno, col_offset) {
        this.left = left;
        this.op = op;
        this.right = right;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return BinOp;
})();
exports.BinOp = BinOp;

var UnaryOp = (function () {
    function UnaryOp(op, operand, lineno, col_offset) {
        this.op = op;
        this.operand = operand;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return UnaryOp;
})();
exports.UnaryOp = UnaryOp;

var Lambda = (function () {
    function Lambda(args, body, lineno, col_offset) {
        this.args = args;
        this.body = body;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Lambda;
})();
exports.Lambda = Lambda;

var IfExp = (function () {
    function IfExp(test, body, orelse, lineno, col_offset) {
        this.test = test;
        this.body = body;
        this.orelse = orelse;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return IfExp;
})();
exports.IfExp = IfExp;

var Dict = (function () {
    function Dict(keys, values, lineno, col_offset) {
        this.keys = keys;
        this.values = values;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Dict;
})();
exports.Dict = Dict;

var ListComp = (function () {
    function ListComp(elt, generators, lineno, col_offset) {
        this.elt = elt;
        this.generators = generators;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return ListComp;
})();
exports.ListComp = ListComp;

var GeneratorExp = (function () {
    function GeneratorExp(elt, generators, lineno, col_offset) {
        this.elt = elt;
        this.generators = generators;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return GeneratorExp;
})();
exports.GeneratorExp = GeneratorExp;

var Yield = (function () {
    function Yield(value, lineno, col_offset) {
        this.value = value;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Yield;
})();
exports.Yield = Yield;

var Compare = (function () {
    function Compare(left, ops, comparators, lineno, col_offset) {
        this.left = left;
        this.ops = ops;
        this.comparators = comparators;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Compare;
})();
exports.Compare = Compare;

var Call = (function () {
    function Call(func, args, keywords, starargs, kwargs, lineno, col_offset) {
        this.func = func;
        this.args = args;
        this.keywords = keywords;
        this.starargs = starargs;
        this.kwargs = kwargs;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Call;
})();
exports.Call = Call;

var Num = (function () {
    function Num(n, lineno, col_offset) {
        this.n = n;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Num;
})();
exports.Num = Num;

var Str = (function () {
    function Str(s, lineno, col_offset) {
        this.s = s;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Str;
})();
exports.Str = Str;

var Attribute = (function () {
    function Attribute(value, attr, ctx, lineno, col_offset) {
        this.value = value;
        this.attr = attr;
        this.ctx = ctx;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Attribute;
})();
exports.Attribute = Attribute;

var Subscript = (function () {
    function Subscript(value, slice, ctx, lineno, col_offset) {
        this.value = value;
        this.slice = slice;
        this.ctx = ctx;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Subscript;
})();
exports.Subscript = Subscript;

var Name = (function () {
    function Name(id, ctx, lineno, col_offset) {
        this.id = id;
        this.ctx = ctx;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Name;
})();
exports.Name = Name;

var List = (function () {
    function List(elts, ctx, lineno, col_offset) {
        this.elts = elts;
        this.ctx = ctx;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return List;
})();
exports.List = List;

var Tuple = (function () {
    function Tuple(elts, ctx, lineno, col_offset) {
        this.elts = elts;
        this.ctx = ctx;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return Tuple;
})();
exports.Tuple = Tuple;

var Ellipsis = (function () {
    function Ellipsis() {
    }
    return Ellipsis;
})();
exports.Ellipsis = Ellipsis;

var Slice = (function () {
    function Slice(lower, upper, step) {
        this.lower = lower;
        this.upper = upper;
        this.step = step;
    }
    return Slice;
})();
exports.Slice = Slice;

var ExtSlice = (function () {
    function ExtSlice(dims) {
        this.dims = dims;
    }
    return ExtSlice;
})();
exports.ExtSlice = ExtSlice;

var Index = (function () {
    function Index(value) {
        this.value = value;
    }
    return Index;
})();
exports.Index = Index;

var Comprehension = (function () {
    function Comprehension(target, iter, ifs) {
        this.target = target;
        this.iter = iter;
        this.ifs = ifs;
    }
    return Comprehension;
})();
exports.Comprehension = Comprehension;

var ExceptHandler = (function () {
    function ExceptHandler(type, name, body, lineno, col_offset) {
        this.type = type;
        this.name = name;
        this.body = body;
        this.lineno = lineno;
        this.col_offset = col_offset;
    }
    return ExceptHandler;
})();
exports.ExceptHandler = ExceptHandler;

var Arguments = (function () {
    function Arguments(args, vararg, kwarg, defaults) {
        this.args = args;
        this.vararg = vararg;
        this.kwarg = kwarg;
        this.defaults = defaults;
    }
    return Arguments;
})();
exports.Arguments = Arguments;

var Keyword = (function () {
    function Keyword(arg, value) {
        this.arg = arg;
        this.value = value;
    }
    return Keyword;
})();
exports.Keyword = Keyword;

var Alias = (function () {
    function Alias(name, asname) {
        this.name = name;
        this.asname = asname;
    }
    return Alias;
})();
exports.Alias = Alias;
});

ace.define("ace/mode/python/numericLiteral",["require","exports","module"], function(require, exports, module) {
"no use strict";
function floatAST(s) {
    var thing = {
        text: s,
        value: parseFloat(s),
        isFloat: function () {
            return true;
        },
        isInt: function () {
            return false;
        },
        isLong: function () {
            return false;
        },
        toString: function () {
            return s;
        }
    };
    return thing;
}
exports.floatAST = floatAST;
function intAST(n) {
    var thing = {
        value: n,
        isFloat: function () {
            return false;
        },
        isInt: function () {
            return true;
        },
        isLong: function () {
            return false;
        },
        toString: function () {
            return '' + n;
        }
    };
    return thing;
}
exports.intAST = intAST;
function longAST(s, radix) {
    var thing = {
        text: s,
        radix: radix,
        isFloat: function () {
            return false;
        },
        isInt: function () {
            return false;
        },
        isLong: function () {
            return true;
        },
        toString: function () {
            return s;
        }
    };
    return thing;
}
exports.longAST = longAST;
});

ace.define("ace/mode/python/builder",["require","exports","module","ace/mode/python/asserts","ace/mode/python/astnodes","ace/mode/python/base","ace/mode/python/numericLiteral","ace/mode/python/tables","ace/mode/python/Tokenizer"], function(require, exports, module) {
"no use strict";
var asserts = require('./asserts');
var astnodes = require('./astnodes');
var base = require('./base');
var numericLiteral = require('./numericLiteral');

var tables = require('./tables');
var Tokenizer = require('./Tokenizer');
var ParseTables = tables.ParseTables;
var SYM = ParseTables.sym;
var TOK = Tokenizer.Tokens;
var LONG_THRESHOLD = Math.pow(2, 53);
function syntaxError(message, fileName, lineNumber) {
    asserts.assert(base.isString(message), "message must be a string");
    asserts.assert(base.isString(fileName), "fileName must be a string");
    asserts.assert(base.isNumber(lineNumber), "lineNumber must be a number");
    var e = new SyntaxError(message);
    e['fileName'] = fileName;
    e['lineNumber'] = lineNumber;
    return e;
}

var Compiling = (function () {
    function Compiling(encoding, filename) {
        this.c_encoding = encoding;
        this.c_filename = filename;
    }
    return Compiling;
})();
function NCH(n) {
    asserts.assert(n !== undefined);
    if (n.children === null)
        return 0;
    return n.children.length;
}

function CHILD(n, i) {
    asserts.assert(n !== undefined);
    asserts.assert(i !== undefined);
    return n.children[i];
}

function REQ(n, type) {
    asserts.assert(n.type === type, "node wasn't expected type");
}

function strobj(s) {
    asserts.assert(typeof s === "string", "expecting string, got " + (typeof s));
    return s;
}
function numStmts(n) {
    switch (n.type) {
        case SYM.single_input:
            if (CHILD(n, 0).type === TOK.T_NEWLINE)
                return 0;
            else
                return numStmts(CHILD(n, 0));
        case SYM.file_input:
            var cnt = 0;
            for (var i = 0; i < NCH(n); ++i) {
                var ch = CHILD(n, i);
                if (ch.type === SYM.stmt)
                    cnt += numStmts(ch);
            }
            return cnt;
        case SYM.stmt:
            return numStmts(CHILD(n, 0));
        case SYM.compound_stmt:
            return 1;
        case SYM.simple_stmt:
            return Math.floor(NCH(n) / 2);
        case SYM.suite:
            if (NCH(n) === 1)
                return numStmts(CHILD(n, 0));
            else {
                var cnt = 0;
                for (var i = 2; i < NCH(n) - 1; ++i)
                    cnt += numStmts(CHILD(n, i));
                return cnt;
            }
        default:
            asserts.fail("Non-statement found");
    }
    return 0;
}

function forbiddenCheck(c, n, x, lineno) {
    if (x === "None")
        throw syntaxError("assignment to None", c.c_filename, lineno);
    if (x === "True" || x === "False")
        throw syntaxError("assignment to True or False is forbidden", c.c_filename, lineno);
}
function setContext(c, e, ctx, n) {
    asserts.assert(ctx !== astnodes.AugStore && ctx !== astnodes.AugLoad);
    var s = null;
    var exprName = null;

    switch (e.constructor) {
        case astnodes.Attribute:
        case astnodes.Name:
            if (ctx === astnodes.Store)
                forbiddenCheck(c, n, e.attr, n.lineno);
            e.ctx = ctx;
            break;
        case astnodes.Subscript:
            e.ctx = ctx;
            break;
        case astnodes.List:
            e.ctx = ctx;
            s = e.elts;
            break;
        case astnodes.Tuple:
            if (e.elts.length === 0)
                throw syntaxError("can't assign to ()", c.c_filename, n.lineno);
            e.ctx = ctx;
            s = e.elts;
            break;
        case astnodes.Lambda:
            exprName = "lambda";
            break;
        case astnodes.Call:
            exprName = "function call";
            break;
        case astnodes.BoolOp:
        case astnodes.BinOp:
        case astnodes.UnaryOp:
            exprName = "operator";
            break;
        case astnodes.GeneratorExp:
            exprName = "generator expression";
            break;
        case astnodes.Yield:
            exprName = "yield expression";
            break;
        case astnodes.ListComp:
            exprName = "list comprehension";
            break;
        case astnodes.Dict:
        case astnodes.Num:
        case astnodes.Str:
            exprName = "literal";
            break;
        case astnodes.Compare:
            exprName = "comparison expression";
            break;
        case astnodes.IfExp:
            exprName = "conditional expression";
            break;
        default:
            asserts.fail("unhandled expression in assignment");
    }
    if (exprName) {
        throw syntaxError("can't " + (ctx === astnodes.Store ? "assign to" : "delete") + " " + exprName, c.c_filename, n.lineno);
    }

    if (s) {
        for (var i = 0; i < s.length; ++i) {
            setContext(c, s[i], ctx, n);
        }
    }
}

var operatorMap = {};
(function () {
    operatorMap[TOK.T_VBAR] = astnodes.BitOr;
    operatorMap[TOK.T_VBAR] = astnodes.BitOr;
    operatorMap[TOK.T_CIRCUMFLEX] = astnodes.BitXor;
    operatorMap[TOK.T_AMPER] = astnodes.BitAnd;
    operatorMap[TOK.T_LEFTSHIFT] = astnodes.LShift;
    operatorMap[TOK.T_RIGHTSHIFT] = astnodes.RShift;
    operatorMap[TOK.T_PLUS] = astnodes.Add;
    operatorMap[TOK.T_MINUS] = astnodes.Sub;
    operatorMap[TOK.T_STAR] = astnodes.Mult;
    operatorMap[TOK.T_SLASH] = astnodes.Div;
    operatorMap[TOK.T_DOUBLESLASH] = astnodes.FloorDiv;
    operatorMap[TOK.T_PERCENT] = astnodes.Mod;
}());

function getOperator(n) {
    asserts.assert(operatorMap[n.type] !== undefined);
    return operatorMap[n.type];
}

function astForCompOp(c, n) {
    REQ(n, SYM.comp_op);
    if (NCH(n) === 1) {
        n = CHILD(n, 0);
        switch (n.type) {
            case TOK.T_LESS:
                return astnodes.Lt;
            case TOK.T_GREATER:
                return astnodes.Gt;
            case TOK.T_EQEQUAL:
                return astnodes.Eq;
            case TOK.T_LESSEQUAL:
                return astnodes.LtE;
            case TOK.T_GREATEREQUAL:
                return astnodes.GtE;
            case TOK.T_NOTEQUAL:
                return astnodes.NotEq;
            case TOK.T_NAME:
                if (n.value === "in")
                    return astnodes.In_;
                if (n.value === "is")
                    return astnodes.Is;
        }
    } else if (NCH(n) === 2) {
        if (CHILD(n, 0).type === TOK.T_NAME) {
            if (CHILD(n, 1).value === "in")
                return astnodes.NotIn;
            if (CHILD(n, 0).value === "is")
                return astnodes.IsNot;
        }
    }
    asserts.fail("invalid comp_op");
}

function seqForTestlist(c, n) {
    asserts.assert(n.type === SYM.testlist || n.type === SYM.listmaker || n.type === SYM.testlist_gexp || n.type === SYM.testlist_safe || n.type === SYM.testlist1);
    var seq = [];
    for (var i = 0; i < NCH(n); i += 2) {
        asserts.assert(CHILD(n, i).type === SYM.IfExpr || CHILD(n, i).type === SYM.old_test);
        seq[i / 2] = astForExpr(c, CHILD(n, i));
    }
    return seq;
}

function astForSuite(c, n) {
    REQ(n, SYM.suite);
    var seq = [];
    var pos = 0;
    var ch;
    if (CHILD(n, 0).type === SYM.simple_stmt) {
        n = CHILD(n, 0);
        var end = NCH(n) - 1;
        if (CHILD(n, end - 1).type === TOK.T_SEMI)
            end -= 1;
        for (var i = 0; i < end; i += 2)
            seq[pos++] = astForStmt(c, CHILD(n, i));
    } else {
        for (var i = 2; i < NCH(n) - 1; ++i) {
            ch = CHILD(n, i);
            REQ(ch, SYM.stmt);
            var num = numStmts(ch);
            if (num === 1) {
                seq[pos++] = astForStmt(c, ch);
            } else {
                ch = CHILD(ch, 0);
                REQ(ch, SYM.simple_stmt);
                for (var j = 0; j < NCH(ch); j += 2) {
                    if (NCH(CHILD(ch, j)) === 0) {
                        asserts.assert(j + 1 === NCH(ch));
                        break;
                    }
                    seq[pos++] = astForStmt(c, CHILD(ch, j));
                }
            }
        }
    }
    asserts.assert(pos === numStmts(n));
    return seq;
}

function astForExceptClause(c, exc, body) {
    REQ(exc, SYM.except_clause);
    REQ(body, SYM.suite);
    if (NCH(exc) === 1)
        return new astnodes.ExceptHandler(null, null, astForSuite(c, body), exc.lineno, exc.col_offset);
    else if (NCH(exc) === 2)
        return new astnodes.ExceptHandler(astForExpr(c, CHILD(exc, 1)), null, astForSuite(c, body), exc.lineno, exc.col_offset);
    else if (NCH(exc) === 4) {
        var e = astForExpr(c, CHILD(exc, 3));
        setContext(c, e, astnodes.Store, CHILD(exc, 3));
        return new astnodes.ExceptHandler(astForExpr(c, CHILD(exc, 1)), e, astForSuite(c, body), exc.lineno, exc.col_offset);
    }
    asserts.fail("wrong number of children for except clause");
}

function astForTryStmt(c, n) {
    var nc = NCH(n);
    var nexcept = (nc - 3) / 3;
    var body, orelse = [], finally_ = null;

    REQ(n, SYM.try_stmt);
    body = astForSuite(c, CHILD(n, 2));
    if (CHILD(n, nc - 3).type === TOK.T_NAME) {
        if (CHILD(n, nc - 3).value === "finally") {
            if (nc >= 9 && CHILD(n, nc - 6).type === TOK.T_NAME) {
                orelse = astForSuite(c, CHILD(n, nc - 4));
                nexcept--;
            }

            finally_ = astForSuite(c, CHILD(n, nc - 1));
            nexcept--;
        } else {
            orelse = astForSuite(c, CHILD(n, nc - 1));
            nexcept--;
        }
    } else if (CHILD(n, nc - 3).type !== SYM.except_clause) {
        throw syntaxError("malformed 'try' statement", c.c_filename, n.lineno);
    }

    if (nexcept > 0) {
        var handlers = [];
        for (var i = 0; i < nexcept; ++i)
            handlers[i] = astForExceptClause(c, CHILD(n, 3 + i * 3), CHILD(n, 5 + i * 3));
        var exceptSt = new astnodes.TryExcept(body, handlers, orelse, n.lineno, n.col_offset);

        if (!finally_)
            return exceptSt;
        body = [exceptSt];
    }

    asserts.assert(finally_ !== null);
    return new astnodes.TryFinally(body, finally_, n.lineno, n.col_offset);
}

function astForDottedName(c, n) {
    REQ(n, SYM.dotted_name);
    var lineno = n.lineno;
    var col_offset = n.col_offset;
    var id = strobj(CHILD(n, 0).value);
    var e = new astnodes.Name(id, astnodes.Load, lineno, col_offset);
    for (var i = 2; i < NCH(n); i += 2) {
        id = strobj(CHILD(n, i).value);
        e = new astnodes.Attribute(e, id, astnodes.Load, lineno, col_offset);
    }
    return e;
}

function astForDecorator(c, n) {
    REQ(n, SYM.decorator);
    REQ(CHILD(n, 0), TOK.T_AT);
    REQ(CHILD(n, NCH(n) - 1), TOK.T_NEWLINE);
    var nameExpr = astForDottedName(c, CHILD(n, 1));
    var d;
    if (NCH(n) === 3)
        return nameExpr;
    else if (NCH(n) === 5)
        return new astnodes.Call(nameExpr, [], [], null, null, n.lineno, n.col_offset);
    else
        return astForCall(c, CHILD(n, 3), nameExpr);
}

function astForDecorators(c, n) {
    REQ(n, SYM.decorators);
    var decoratorSeq = [];
    for (var i = 0; i < NCH(n); ++i)
        decoratorSeq[i] = astForDecorator(c, CHILD(n, i));
    return decoratorSeq;
}

function astForDecorated(c, n) {
    REQ(n, SYM.decorated);
    var decoratorSeq = astForDecorators(c, CHILD(n, 0));
    asserts.assert(CHILD(n, 1).type === SYM.funcdef || CHILD(n, 1).type === SYM.classdef);

    var thing = null;
    if (CHILD(n, 1).type === SYM.funcdef)
        thing = astForFuncdef(c, CHILD(n, 1), decoratorSeq);
    else if (CHILD(n, 1).type === SYM.classdef)
        thing = astForClassdef(c, CHILD(n, 1), decoratorSeq);
    if (thing) {
        thing.lineno = n.lineno;
        thing.col_offset = n.col_offset;
    }
    return thing;
}

function astForWithVar(c, n) {
    REQ(n, SYM.with_var);
    return astForExpr(c, CHILD(n, 1));
}

function astForWithStmt(c, n) {
    var suiteIndex = 3;
    asserts.assert(n.type === SYM.with_stmt);
    var contextExpr = astForExpr(c, CHILD(n, 1));
    if (CHILD(n, 2).type === SYM.with_var) {
        var optionalVars = astForWithVar(c, CHILD(n, 2));
        setContext(c, optionalVars, astnodes.Store, n);
        suiteIndex = 4;
    }
    return new astnodes.With_(contextExpr, optionalVars, astForSuite(c, CHILD(n, suiteIndex)), n.lineno, n.col_offset);
}

function astForExecStmt(c, n) {
    var expr1;
    var globals = null, locals = null;
    var nchildren = NCH(n);
    asserts.assert(nchildren === 2 || nchildren === 4 || nchildren === 6);
    REQ(n, SYM.exec_stmt);
    var expr1 = astForExpr(c, CHILD(n, 1));
    if (nchildren >= 4)
        globals = astForExpr(c, CHILD(n, 3));
    if (nchildren === 6)
        locals = astForExpr(c, CHILD(n, 5));
    return new astnodes.Exec(expr1, globals, locals, n.lineno, n.col_offset);
}

function astForIfStmt(c, n) {
    REQ(n, SYM.if_stmt);
    if (NCH(n) === 4)
        return new astnodes.If_(astForExpr(c, CHILD(n, 1)), astForSuite(c, CHILD(n, 3)), [], n.lineno, n.col_offset);

    var s = CHILD(n, 4).value;
    var decider = s.charAt(2);
    if (decider === 's') {
        return new astnodes.If_(astForExpr(c, CHILD(n, 1)), astForSuite(c, CHILD(n, 3)), astForSuite(c, CHILD(n, 6)), n.lineno, n.col_offset);
    } else if (decider === 'i') {
        var nElif = NCH(n) - 4;
        var hasElse = false;
        var orelse = [];
        if (CHILD(n, nElif + 1).type === TOK.T_NAME && CHILD(n, nElif + 1).value.charAt(2) === 's') {
            hasElse = true;
            nElif -= 3;
        }
        nElif /= 4;

        if (hasElse) {
            orelse = [new astnodes.If_(astForExpr(c, CHILD(n, NCH(n) - 6)), astForSuite(c, CHILD(n, NCH(n) - 4)), astForSuite(c, CHILD(n, NCH(n) - 1)), CHILD(n, NCH(n) - 6).lineno, CHILD(n, NCH(n) - 6).col_offset)];
            nElif--;
        }

        for (var i = 0; i < nElif; ++i) {
            var off = 5 + (nElif - i - 1) * 4;
            orelse = [new astnodes.If_(astForExpr(c, CHILD(n, off)), astForSuite(c, CHILD(n, off + 2)), orelse, CHILD(n, off).lineno, CHILD(n, off).col_offset)];
        }
        return new astnodes.If_(astForExpr(c, CHILD(n, 1)), astForSuite(c, CHILD(n, 3)), orelse, n.lineno, n.col_offset);
    }
    asserts.fail("unexpected token in 'if' statement");
}

function astForExprlist(c, n, context) {
    REQ(n, SYM.ExprList);
    var seq = [];
    for (var i = 0; i < NCH(n); i += 2) {
        var e = astForExpr(c, CHILD(n, i));
        seq[i / 2] = e;
        if (context)
            setContext(c, e, context, CHILD(n, i));
    }
    return seq;
}

function astForDelStmt(c, n) {
    REQ(n, SYM.del_stmt);
    return new astnodes.Delete_(astForExprlist(c, CHILD(n, 1), astnodes.Del), n.lineno, n.col_offset);
}

function astForGlobalStmt(c, n) {
    REQ(n, SYM.GlobalStmt);
    var s = [];
    for (var i = 1; i < NCH(n); i += 2) {
        s[(i - 1) / 2] = strobj(CHILD(n, i).value);
    }
    return new astnodes.Global(s, n.lineno, n.col_offset);
}

function astForNonLocalStmt(c, n) {
    REQ(n, SYM.NonLocalStmt);
    var s = [];
    for (var i = 1; i < NCH(n); i += 2) {
        s[(i - 1) / 2] = strobj(CHILD(n, i).value);
    }
    return new astnodes.NonLocal(s, n.lineno, n.col_offset);
}

function astForAssertStmt(c, n) {
    REQ(n, SYM.assert_stmt);
    if (NCH(n) === 2)
        return new astnodes.Assert(astForExpr(c, CHILD(n, 1)), null, n.lineno, n.col_offset);
    else if (NCH(n) === 4)
        return new astnodes.Assert(astForExpr(c, CHILD(n, 1)), astForExpr(c, CHILD(n, 3)), n.lineno, n.col_offset);
    asserts.fail("improper number of parts to assert stmt");
}

function aliasForImportName(c, n) {
    loop:
    while (true) {
        switch (n.type) {
            case SYM.import_as_name:
                var str = null;
                var name = strobj(CHILD(n, 0).value);
                if (NCH(n) === 3)
                    str = CHILD(n, 2).value;
                return new astnodes.Alias(name, str == null ? null : strobj(str));
            case SYM.dotted_as_name:
                if (NCH(n) === 1) {
                    n = CHILD(n, 0);
                    continue loop;
                } else {
                    var a = aliasForImportName(c, CHILD(n, 0));
                    asserts.assert(!a.asname);
                    a.asname = strobj(CHILD(n, 2).value);
                    return a;
                }
            case SYM.dotted_name:
                if (NCH(n) === 1)
                    return new astnodes.Alias(strobj(CHILD(n, 0).value), null);
                else {
                    var str = '';
                    for (var i = 0; i < NCH(n); i += 2)
                        str += CHILD(n, i).value + ".";
                    return new astnodes.Alias(strobj(str.substr(0, str.length - 1)), null);
                }
            case TOK.T_STAR:
                return new astnodes.Alias(strobj("*"), null);
            default:
                throw syntaxError("unexpected import name", c.c_filename, n.lineno);
        }
        break;
    }
}

function astForImportStmt(c, n) {
    REQ(n, SYM.import_stmt);
    var lineno = n.lineno;
    var col_offset = n.col_offset;
    n = CHILD(n, 0);
    if (n.type === SYM.import_name) {
        n = CHILD(n, 1);
        REQ(n, SYM.dotted_as_names);
        var aliases = [];
        for (var i = 0; i < NCH(n); i += 2)
            aliases[i / 2] = aliasForImportName(c, CHILD(n, i));
        return new astnodes.Import_(aliases, lineno, col_offset);
    } else if (n.type === SYM.import_from) {
        var mod = null;
        var ndots = 0;
        var nchildren;

        for (var idx = 1; idx < NCH(n); ++idx) {
            if (CHILD(n, idx).type === SYM.dotted_name) {
                mod = aliasForImportName(c, CHILD(n, idx));
                idx++;
                break;
            } else if (CHILD(n, idx).type !== TOK.T_DOT)
                break;
            ndots++;
        }
        ++idx; // skip the import keyword
        switch (CHILD(n, idx).type) {
            case TOK.T_STAR:
                n = CHILD(n, idx);
                nchildren = 1;
                break;
            case TOK.T_LPAR:
                n = CHILD(n, idx + 1);
                nchildren = NCH(n);
                break;
            case SYM.import_as_names:
                n = CHILD(n, idx);
                nchildren = NCH(n);
                if (nchildren % 2 === 0)
                    throw syntaxError("trailing comma not allowed without surrounding parentheses", c.c_filename, n.lineno);
                break;
            default:
                throw syntaxError("Unexpected node-type in from-import", c.c_filename, n.lineno);
        }
        var aliases = [];
        if (n.type === TOK.T_STAR)
            aliases[0] = aliasForImportName(c, n);
        else
            for (var i = 0; i < NCH(n); i += 2)
                aliases[i / 2] = aliasForImportName(c, CHILD(n, i));
        var modname = mod ? mod.name : "";
        return new astnodes.ImportFrom(strobj(modname), aliases, ndots, lineno, col_offset);
    }
    throw syntaxError("unknown import statement", c.c_filename, n.lineno);
}

function astForTestlistGexp(c, n) {
    asserts.assert(n.type === SYM.testlist_gexp || n.type === SYM.argument);
    if (NCH(n) > 1 && CHILD(n, 1).type === SYM.gen_for)
        return astForGenexp(c, n);
    return astForTestlist(c, n);
}

function astForListcomp(c, n) {
    function countListFors(c, n) {
        var nfors = 0;
        var ch = CHILD(n, 1);
        count_list_for:
        while (true) {
            nfors++;
            REQ(ch, SYM.list_for);
            if (NCH(ch) === 5)
                ch = CHILD(ch, 4);
            else
                return nfors;
            count_list_iter:
            while (true) {
                REQ(ch, SYM.list_iter);
                ch = CHILD(ch, 0);
                if (ch.type === SYM.list_for)
                    continue count_list_for;
                else if (ch.type === SYM.list_if) {
                    if (NCH(ch) === 3) {
                        ch = CHILD(ch, 2);
                        continue count_list_iter;
                    } else
                        return nfors;
                }
                break;
            }
            break;
        }
    }

    function countListIfs(c, n) {
        var nifs = 0;
        while (true) {
            REQ(n, SYM.list_iter);
            if (CHILD(n, 0).type === SYM.list_for)
                return nifs;
            n = CHILD(n, 0);
            REQ(n, SYM.list_if);
            nifs++;
            if (NCH(n) == 2)
                return nifs;
            n = CHILD(n, 2);
        }
    }

    REQ(n, SYM.listmaker);
    asserts.assert(NCH(n) > 1);
    var elt = astForExpr(c, CHILD(n, 0));
    var nfors = countListFors(c, n);
    var listcomps = [];
    var ch = CHILD(n, 1);
    for (var i = 0; i < nfors; ++i) {
        REQ(ch, SYM.list_for);
        var forch = CHILD(ch, 1);
        var t = astForExprlist(c, forch, astnodes.Store);
        var expression = astForTestlist(c, CHILD(ch, 3));
        var lc;
        if (NCH(forch) === 1)
            lc = new astnodes.Comprehension(t[0], expression, []);
        else
            lc = new astnodes.Comprehension(new astnodes.Tuple(t, astnodes.Store, ch.lineno, ch.col_offset), expression, []);

        if (NCH(ch) === 5) {
            ch = CHILD(ch, 4);
            var nifs = countListIfs(c, ch);
            var ifs = [];
            for (var j = 0; j < nifs; ++j) {
                REQ(ch, SYM.list_iter);
                ch = CHILD(ch, 0);
                REQ(ch, SYM.list_if);
                ifs[j] = astForExpr(c, CHILD(ch, 1));
                if (NCH(ch) === 3)
                    ch = CHILD(ch, 2);
            }
            if (ch.type === SYM.list_iter)
                ch = CHILD(ch, 0);
            lc.ifs = ifs;
        }
        listcomps[i] = lc;
    }
    return new astnodes.ListComp(elt, listcomps, n.lineno, n.col_offset);
}

function astForUnaryExpr(c, n) {
    if (CHILD(n, 0).type === TOK.T_MINUS && NCH(n) === 2) {
        var pfactor = CHILD(n, 1);
        if (pfactor.type === SYM.UnaryExpr && NCH(pfactor) === 1) {
            var ppower = CHILD(pfactor, 0);
            if (ppower.type === SYM.PowerExpr && NCH(ppower) === 1) {
                var patom = CHILD(ppower, 0);
                if (patom.type === SYM.AtomExpr) {
                    var pnum = CHILD(patom, 0);
                    if (pnum.type === TOK.T_NUMBER) {
                        pnum.value = "-" + pnum.value;
                        return astForAtomExpr(c, patom);
                    }
                }
            }
        }
    }

    var expression = astForExpr(c, CHILD(n, 1));
    switch (CHILD(n, 0).type) {
        case TOK.T_PLUS:
            return new astnodes.UnaryOp(astnodes.UAdd, expression, n.lineno, n.col_offset);
        case TOK.T_MINUS:
            return new astnodes.UnaryOp(astnodes.USub, expression, n.lineno, n.col_offset);
        case TOK.T_TILDE:
            return new astnodes.UnaryOp(astnodes.Invert, expression, n.lineno, n.col_offset);
    }

    asserts.fail("unhandled UnaryExpr");
}

function astForForStmt(c, n) {
    var seq = [];
    REQ(n, SYM.for_stmt);
    if (NCH(n) === 9)
        seq = astForSuite(c, CHILD(n, 8));
    var nodeTarget = CHILD(n, 1);
    var _target = astForExprlist(c, nodeTarget, astnodes.Store);
    var target;
    if (NCH(nodeTarget) === 1)
        target = _target[0];
    else
        target = new astnodes.Tuple(_target, astnodes.Store, n.lineno, n.col_offset);

    return new astnodes.For_(target, astForTestlist(c, CHILD(n, 3)), astForSuite(c, CHILD(n, 5)), seq, n.lineno, n.col_offset);
}

function astForCall(c, n, func) {
    REQ(n, SYM.arglist);
    var nargs = 0;
    var nkeywords = 0;
    var ngens = 0;
    for (var i = 0; i < NCH(n); ++i) {
        var ch = CHILD(n, i);
        if (ch.type === SYM.argument) {
            if (NCH(ch) === 1)
                nargs++;
            else if (CHILD(ch, 1).type === SYM.gen_for)
                ngens++;
            else
                nkeywords++;
        }
    }
    if (ngens > 1 || (ngens && (nargs || nkeywords)))
        throw syntaxError("Generator expression must be parenthesized if not sole argument", c.c_filename, n.lineno);
    if (nargs + nkeywords + ngens > 255)
        throw syntaxError("more than 255 arguments", c.c_filename, n.lineno);
    var args = [];
    var keywords = [];
    nargs = 0;
    nkeywords = 0;
    var vararg = null;
    var kwarg = null;
    for (var i = 0; i < NCH(n); ++i) {
        var ch = CHILD(n, i);
        if (ch.type === SYM.argument) {
            if (NCH(ch) === 1) {
                if (nkeywords)
                    throw syntaxError("non-keyword arg after keyword arg", c.c_filename, n.lineno);
                if (vararg)
                    throw syntaxError("only named arguments may follow *expression", c.c_filename, n.lineno);
                args[nargs++] = astForExpr(c, CHILD(ch, 0));
            } else if (CHILD(ch, 1).type === SYM.gen_for)
                args[nargs++] = astForGenexp(c, ch);
            else {
                var e = astForExpr(c, CHILD(ch, 0));
                if (e.constructor === astnodes.Lambda)
                    throw syntaxError("lambda cannot contain assignment", c.c_filename, n.lineno);
                else if (e.constructor !== astnodes.Name)
                    throw syntaxError("keyword can't be an expression", c.c_filename, n.lineno);
                var key = e.id;
                forbiddenCheck(c, CHILD(ch, 0), key, n.lineno);
                for (var k = 0; k < nkeywords; ++k) {
                    var tmp = keywords[k].arg;
                    if (tmp === key)
                        throw syntaxError("keyword argument repeated", c.c_filename, n.lineno);
                }
                keywords[nkeywords++] = new astnodes.Keyword(key, astForExpr(c, CHILD(ch, 2)));
            }
        } else if (ch.type === TOK.T_STAR)
            vararg = astForExpr(c, CHILD(n, ++i));
        else if (ch.type === TOK.T_DOUBLESTAR)
            kwarg = astForExpr(c, CHILD(n, ++i));
    }
    return new astnodes.Call(func, args, keywords, vararg, kwarg, func.lineno, func.col_offset);
}

function astForTrailer(c, n, leftExpr) {
    REQ(n, SYM.trailer);
    if (CHILD(n, 0).type === TOK.T_LPAR) {
        if (NCH(n) === 2)
            return new astnodes.Call(leftExpr, [], [], null, null, n.lineno, n.col_offset);
        else
            return astForCall(c, CHILD(n, 1), leftExpr);
    } else if (CHILD(n, 0).type === TOK.T_DOT)
        return new astnodes.Attribute(leftExpr, strobj(CHILD(n, 1).value), astnodes.Load, n.lineno, n.col_offset);
    else {
        REQ(CHILD(n, 0), TOK.T_LSQB);
        REQ(CHILD(n, 2), TOK.T_RSQB);
        n = CHILD(n, 1);
        if (NCH(n) === 1)
            return new astnodes.Subscript(leftExpr, astForSlice(c, CHILD(n, 0)), astnodes.Load, n.lineno, n.col_offset);
        else {
            var simple = true;
            var slices = [];
            for (var j = 0; j < NCH(n); j += 2) {
                var slc = astForSlice(c, CHILD(n, j));
                if (slc.constructor !== astnodes.Index)
                    simple = false;
                slices[j / 2] = slc;
            }
            if (!simple) {
                return new astnodes.Subscript(leftExpr, new astnodes.ExtSlice(slices), astnodes.Load, n.lineno, n.col_offset);
            }
            var elts = [];
            for (var j = 0; j < slices.length; ++j) {
                var slc = slices[j];
                asserts.assert(slc.constructor === astnodes.Index && slc.value !== null && slc.value !== undefined);
                elts[j] = slc.value;
            }
            var e = new astnodes.Tuple(elts, astnodes.Load, n.lineno, n.col_offset);
            return new astnodes.Subscript(leftExpr, new astnodes.Index(e), astnodes.Load, n.lineno, n.col_offset);
        }
    }
}

function astForFlowStmt(c, n) {
    var ch;
    REQ(n, SYM.flow_stmt);
    ch = CHILD(n, 0);
    switch (ch.type) {
        case SYM.break_stmt:
            return new astnodes.Break_(n.lineno, n.col_offset);
        case SYM.continue_stmt:
            return new astnodes.Continue_(n.lineno, n.col_offset);
        case SYM.yield_stmt:
            return new astnodes.Expr(astForExpr(c, CHILD(ch, 0)), n.lineno, n.col_offset);
        case SYM.return_stmt:
            if (NCH(ch) === 1)
                return new astnodes.Return_(null, n.lineno, n.col_offset);
            else
                return new astnodes.Return_(astForTestlist(c, CHILD(ch, 1)), n.lineno, n.col_offset);
        case SYM.raise_stmt:
            if (NCH(ch) === 1)
                return new astnodes.Raise(null, null, null, n.lineno, n.col_offset);
            else if (NCH(ch) === 2)
                return new astnodes.Raise(astForExpr(c, CHILD(ch, 1)), null, null, n.lineno, n.col_offset);
            else if (NCH(ch) === 4)
                return new astnodes.Raise(astForExpr(c, CHILD(ch, 1)), astForExpr(c, CHILD(ch, 3)), null, n.lineno, n.col_offset);
            else if (NCH(ch) === 6)
                return new astnodes.Raise(astForExpr(c, CHILD(ch, 1)), astForExpr(c, CHILD(ch, 3)), astForExpr(c, CHILD(ch, 5)), n.lineno, n.col_offset);
        default:
            asserts.fail("unexpected flow_stmt");
    }
    asserts.fail("unhandled flow statement");
}

function astForArguments(c, n) {
    var ch;
    var vararg = null;
    var kwarg = null;
    if (n.type === SYM.parameters) {
        if (NCH(n) === 2)
            return new astnodes.Arguments([], null, null, []);
        n = CHILD(n, 1);
    }
    REQ(n, SYM.varargslist);

    var args = [];
    var defaults = [];
    var foundDefault = false;
    var i = 0;
    var j = 0;
    var k = 0;
    while (i < NCH(n)) {
        ch = CHILD(n, i);
        switch (ch.type) {
            case SYM.fpdef:
                var complexArgs = 0;
                var parenthesized = false;
                handle_fpdef:
                while (true) {
                    if (i + 1 < NCH(n) && CHILD(n, i + 1).type === TOK.T_EQUAL) {
                        defaults[j++] = astForExpr(c, CHILD(n, i + 2));
                        i += 2;
                        foundDefault = true;
                    } else if (foundDefault) {
                        if (parenthesized && !complexArgs)
                            throw syntaxError("parenthesized arg with default", c.c_filename, n.lineno);
                        throw syntaxError("non-default argument follows default argument", c.c_filename, n.lineno);
                    }

                    if (NCH(ch) === 3) {
                        ch = CHILD(ch, 1);
                        if (NCH(ch) !== 1) {
                            throw syntaxError("tuple parameter unpacking has been removed", c.c_filename, n.lineno);
                        } else {
                            parenthesized = true;
                            ch = CHILD(ch, 0);
                            asserts.assert(ch.type === SYM.fpdef);
                            continue handle_fpdef;
                        }
                    }
                    if (CHILD(ch, 0).type === TOK.T_NAME) {
                        forbiddenCheck(c, n, CHILD(ch, 0).value, n.lineno);
                        var id = strobj(CHILD(ch, 0).value);
                        args[k++] = new astnodes.Name(id, astnodes.Param, ch.lineno, ch.col_offset);
                    }
                    i += 2;
                    if (parenthesized)
                        throw syntaxError("parenthesized argument names are invalid", c.c_filename, n.lineno);
                    break;
                }
                break;
            case TOK.T_STAR:
                forbiddenCheck(c, CHILD(n, i + 1), CHILD(n, i + 1).value, n.lineno);
                vararg = strobj(CHILD(n, i + 1).value);
                i += 3;
                break;
            case TOK.T_DOUBLESTAR:
                forbiddenCheck(c, CHILD(n, i + 1), CHILD(n, i + 1).value, n.lineno);
                kwarg = strobj(CHILD(n, i + 1).value);
                i += 3;
                break;
            default:
                asserts.fail("unexpected node in varargslist");
        }
    }
    return new astnodes.Arguments(args, vararg, kwarg, defaults);
}

function astForFuncdef(c, n, decoratorSeq) {
    REQ(n, SYM.funcdef);
    var name = strobj(CHILD(n, 1).value);
    forbiddenCheck(c, CHILD(n, 1), CHILD(n, 1).value, n.lineno);
    var args = astForArguments(c, CHILD(n, 2));
    var body = astForSuite(c, CHILD(n, 4));
    return new astnodes.FunctionDef(name, args, body, decoratorSeq, n.lineno, n.col_offset);
}

function astForClassBases(c, n) {
    asserts.assert(NCH(n) > 0);
    REQ(n, SYM.testlist);
    if (NCH(n) === 1)
        return [astForExpr(c, CHILD(n, 0))];
    return seqForTestlist(c, n);
}

function astForClassdef(c, n, decoratorSeq) {
    REQ(n, SYM.classdef);
    forbiddenCheck(c, n, CHILD(n, 1).value, n.lineno);
    var classname = strobj(CHILD(n, 1).value);
    if (NCH(n) === 4)
        return new astnodes.ClassDef(classname, [], astForSuite(c, CHILD(n, 3)), decoratorSeq, n.lineno, n.col_offset);
    if (CHILD(n, 3).type === TOK.T_RPAR)
        return new astnodes.ClassDef(classname, [], astForSuite(c, CHILD(n, 5)), decoratorSeq, n.lineno, n.col_offset);

    var bases = astForClassBases(c, CHILD(n, 3));
    var s = astForSuite(c, CHILD(n, 6));
    return new astnodes.ClassDef(classname, bases, s, decoratorSeq, n.lineno, n.col_offset);
}

function astForLambdef(c, n) {
    var args;
    var expression;
    if (NCH(n) === 3) {
        args = new astnodes.Arguments([], null, null, []);
        expression = astForExpr(c, CHILD(n, 2));
    } else {
        args = astForArguments(c, CHILD(n, 1));
        expression = astForExpr(c, CHILD(n, 3));
    }
    return new astnodes.Lambda(args, expression, n.lineno, n.col_offset);
}

function astForGenexp(c, n) {
    asserts.assert(n.type === SYM.testlist_gexp || n.type === SYM.argument);
    asserts.assert(NCH(n) > 1);

    function countGenFors(c, n) {
        var nfors = 0;
        var ch = CHILD(n, 1);
        count_gen_for:
        while (true) {
            nfors++;
            REQ(ch, SYM.gen_for);
            if (NCH(ch) === 5)
                ch = CHILD(ch, 4);
            else
                return nfors;
            count_gen_iter:
            while (true) {
                REQ(ch, SYM.gen_iter);
                ch = CHILD(ch, 0);
                if (ch.type === SYM.gen_for)
                    continue count_gen_for;
                else if (ch.type === SYM.gen_if) {
                    if (NCH(ch) === 3) {
                        ch = CHILD(ch, 2);
                        continue count_gen_iter;
                    } else
                        return nfors;
                }
                break;
            }
            break;
        }
        asserts.fail("logic error in countGenFors");
    }

    function countGenIfs(c, n) {
        var nifs = 0;
        while (true) {
            REQ(n, SYM.gen_iter);
            if (CHILD(n, 0).type === SYM.gen_for)
                return nifs;
            n = CHILD(n, 0);
            REQ(n, SYM.gen_if);
            nifs++;
            if (NCH(n) == 2)
                return nifs;
            n = CHILD(n, 2);
        }
    }

    var elt = astForExpr(c, CHILD(n, 0));
    var nfors = countGenFors(c, n);
    var genexps = [];
    var ch = CHILD(n, 1);
    for (var i = 0; i < nfors; ++i) {
        REQ(ch, SYM.gen_for);
        var forch = CHILD(ch, 1);
        var t = astForExprlist(c, forch, astnodes.Store);
        var expression = astForExpr(c, CHILD(ch, 3));
        var ge;
        if (NCH(forch) === 1)
            ge = new astnodes.Comprehension(t[0], expression, []);
        else
            ge = new astnodes.Comprehension(new astnodes.Tuple(t, astnodes.Store, ch.lineno, ch.col_offset), expression, []);
        if (NCH(ch) === 5) {
            ch = CHILD(ch, 4);
            var nifs = countGenIfs(c, ch);
            var ifs = [];
            for (var j = 0; j < nifs; ++j) {
                REQ(ch, SYM.gen_iter);
                ch = CHILD(ch, 0);
                REQ(ch, SYM.gen_if);
                expression = astForExpr(c, CHILD(ch, 1));
                ifs[j] = expression;
                if (NCH(ch) === 3)
                    ch = CHILD(ch, 2);
            }
            if (ch.type === SYM.gen_iter)
                ch = CHILD(ch, 0);
            ge.ifs = ifs;
        }
        genexps[i] = ge;
    }
    return new astnodes.GeneratorExp(elt, genexps, n.lineno, n.col_offset);
}

function astForWhileStmt(c, n) {
    REQ(n, SYM.while_stmt);
    if (NCH(n) === 4)
        return new astnodes.While_(astForExpr(c, CHILD(n, 1)), astForSuite(c, CHILD(n, 3)), [], n.lineno, n.col_offset);
    else if (NCH(n) === 7)
        return new astnodes.While_(astForExpr(c, CHILD(n, 1)), astForSuite(c, CHILD(n, 3)), astForSuite(c, CHILD(n, 6)), n.lineno, n.col_offset);
    asserts.fail("wrong number of tokens for 'while' stmt");
}

function astForAugassign(c, n) {
    REQ(n, SYM.augassign);
    n = CHILD(n, 0);
    switch (n.value.charAt(0)) {
        case '+':
            return astnodes.Add;
        case '-':
            return astnodes.Sub;
        case '/':
            if (n.value.charAt(1) === '/')
                return astnodes.FloorDiv;
            return astnodes.Div;
        case '%':
            return astnodes.Mod;
        case '<':
            return astnodes.LShift;
        case '>':
            return astnodes.RShift;
        case '&':
            return astnodes.BitAnd;
        case '^':
            return astnodes.BitXor;
        case '|':
            return astnodes.BitOr;
        case '*':
            if (n.value.charAt(1) === '*')
                return astnodes.Pow;
            return astnodes.Mult;
        default:
            asserts.fail("invalid augassign");
    }
}

function astForBinop(c, n) {
    var result = new astnodes.BinOp(astForExpr(c, CHILD(n, 0)), getOperator(CHILD(n, 1)), astForExpr(c, CHILD(n, 2)), n.lineno, n.col_offset);
    var nops = (NCH(n) - 1) / 2;
    for (var i = 1; i < nops; ++i) {
        var nextOper = CHILD(n, i * 2 + 1);
        var newoperator = getOperator(nextOper);
        var tmp = astForExpr(c, CHILD(n, i * 2 + 2));
        result = new astnodes.BinOp(result, newoperator, tmp, nextOper.lineno, nextOper.col_offset);
    }
    return result;
}

function astForTestlist(c, n) {
    asserts.assert(NCH(n) > 0);
    if (n.type === SYM.testlist_gexp) {
        if (NCH(n) > 1) {
            asserts.assert(CHILD(n, 1).type !== SYM.gen_for);
        }
    } else {
        asserts.assert(n.type === SYM.testlist || n.type === SYM.testlist_safe || n.type === SYM.testlist1);
    }

    if (NCH(n) === 1) {
        return astForExpr(c, CHILD(n, 0));
    } else {
        return new astnodes.Tuple(seqForTestlist(c, n), astnodes.Load, n.lineno, n.col_offset);
    }
}

function astForExprStmt(c, n) {
    REQ(n, SYM.ExprStmt);
    if (NCH(n) === 1)
        return new astnodes.Expr(astForTestlist(c, CHILD(n, 0)), n.lineno, n.col_offset);
    else if (CHILD(n, 1).type === SYM.augassign) {
        var ch = CHILD(n, 0);
        var expr1 = astForTestlist(c, ch);
        switch (expr1.constructor) {
            case astnodes.GeneratorExp:
                throw syntaxError("augmented assignment to generator expression not possible", c.c_filename, n.lineno);
            case astnodes.Yield:
                throw syntaxError("augmented assignment to yield expression not possible", c.c_filename, n.lineno);
            case astnodes.Name:
                var varName = expr1.id;
                forbiddenCheck(c, ch, varName, n.lineno);
                break;
            case astnodes.Attribute:
            case astnodes.Subscript:
                break;
            default:
                throw syntaxError("illegal expression for augmented assignment", c.c_filename, n.lineno);
        }
        setContext(c, expr1, astnodes.Store, ch);

        ch = CHILD(n, 2);
        var expr2;
        if (ch.type === SYM.testlist)
            expr2 = astForTestlist(c, ch);
        else
            expr2 = astForExpr(c, ch);

        return new astnodes.AugAssign(expr1, astForAugassign(c, CHILD(n, 1)), expr2, n.lineno, n.col_offset);
    } else {
        REQ(CHILD(n, 1), TOK.T_EQUAL);
        var targets = [];
        for (var i = 0; i < NCH(n) - 2; i += 2) {
            var ch = CHILD(n, i);
            if (ch.type === SYM.YieldExpr)
                throw syntaxError("assignment to yield expression not possible", c.c_filename, n.lineno);
            var e = astForTestlist(c, ch);
            setContext(c, e, astnodes.Store, CHILD(n, i));
            targets[i / 2] = e;
        }
        var value = CHILD(n, NCH(n) - 1);
        var expression;
        if (value.type === SYM.testlist)
            expression = astForTestlist(c, value);
        else
            expression = astForExpr(c, value);
        return new astnodes.Assign(targets, expression, n.lineno, n.col_offset);
    }
}

function astForIfexpr(c, n) {
    asserts.assert(NCH(n) === 5);
    return new astnodes.IfExp(astForExpr(c, CHILD(n, 2)), astForExpr(c, CHILD(n, 0)), astForExpr(c, CHILD(n, 4)), n.lineno, n.col_offset);
}
function parsestr(c, s) {
    var decodeUtf8 = function (s) {
        return decodeURI(s);
    };
    var decodeEscape = function (s, quote) {
        var len = s.length;
        var ret = '';
        for (var i = 0; i < len; ++i) {
            var c = s.charAt(i);
            if (c === '\\') {
                ++i;
                c = s.charAt(i);
                if (c === 'n')
                    ret += "\n";
                else if (c === '\\')
                    ret += "\\";
                else if (c === 't')
                    ret += "\t";
                else if (c === 'r')
                    ret += "\r";
                else if (c === 'b')
                    ret += "\b";
                else if (c === 'f')
                    ret += "\f";
                else if (c === 'v')
                    ret += "\v";
                else if (c === '0')
                    ret += "\0";
                else if (c === '"')
                    ret += '"';
                else if (c === '\'')
                    ret += '\'';
                else if (c === '\n') {
                } else if (c === 'x') {
                    var d0 = s.charAt(++i);
                    var d1 = s.charAt(++i);
                    ret += String.fromCharCode(parseInt(d0 + d1, 16));
                } else if (c === 'u' || c === 'U') {
                    var d0 = s.charAt(++i);
                    var d1 = s.charAt(++i);
                    var d2 = s.charAt(++i);
                    var d3 = s.charAt(++i);
                    ret += String.fromCharCode(parseInt(d0 + d1, 16), parseInt(d2 + d3, 16));
                } else {
                    ret += "\\" + c;
                }
            } else {
                ret += c;
            }
        }
        return ret;
    };

    var quote = s.charAt(0);
    var rawmode = false;

    if (quote === 'u' || quote === 'U') {
        s = s.substr(1);
        quote = s.charAt(0);
    } else if (quote === 'r' || quote === 'R') {
        s = s.substr(1);
        quote = s.charAt(0);
        rawmode = true;
    }
    asserts.assert(quote !== 'b' && quote !== 'B', "todo; haven't done b'' strings yet");

    asserts.assert(quote === "'" || quote === '"' && s.charAt(s.length - 1) === quote);
    s = s.substr(1, s.length - 2);

    if (s.length >= 4 && s.charAt(0) === quote && s.charAt(1) === quote) {
        asserts.assert(s.charAt(s.length - 1) === quote && s.charAt(s.length - 2) === quote);
        s = s.substr(2, s.length - 4);
    }

    if (rawmode || s.indexOf('\\') === -1) {
        return strobj(decodeUtf8(s));
    }
    return strobj(decodeEscape(s, quote));
}
function parsestrplus(c, n) {
    REQ(CHILD(n, 0), TOK.T_STRING);
    var ret = "";
    for (var i = 0; i < NCH(n); ++i) {
        var child = CHILD(n, i);
        try  {
            ret = ret + parsestr(c, child.value);
        } catch (x) {
            throw syntaxError("invalid string (possibly contains a unicode character)", c.c_filename, child.lineno);
        }
    }
    return ret;
}

function parsenumber(c, s, lineno) {
    var end = s.charAt(s.length - 1);

    if (end === 'j' || end === 'J') {
        throw syntaxError("complex numbers are currently unsupported", c.c_filename, lineno);
    }

    if (s.indexOf('.') !== -1) {
        return numericLiteral.floatAST(s);
    }
    var tmp = s;
    var value;
    var radix = 10;
    var neg = false;
    if (s.charAt(0) === '-') {
        tmp = s.substr(1);
        neg = true;
    }

    if (tmp.charAt(0) === '0' && (tmp.charAt(1) === 'x' || tmp.charAt(1) === 'X')) {
        tmp = tmp.substring(2);
        value = parseInt(tmp, 16);
        radix = 16;
    } else if ((s.indexOf('e') !== -1) || (s.indexOf('E') !== -1)) {
        return numericLiteral.floatAST(s);
    } else if (tmp.charAt(0) === '0' && (tmp.charAt(1) === 'b' || tmp.charAt(1) === 'B')) {
        tmp = tmp.substring(2);
        value = parseInt(tmp, 2);
        radix = 2;
    } else if (tmp.charAt(0) === '0') {
        if (tmp === "0") {
            value = 0;
        } else {
            if (end === 'l' || end === 'L') {
                return numericLiteral.longAST(s.substr(0, s.length - 1), 8);
            } else {
                radix = 8;
                tmp = tmp.substring(1);
                if ((tmp.charAt(0) === 'o') || (tmp.charAt(0) === 'O')) {
                    tmp = tmp.substring(1);
                }
                value = parseInt(tmp, 8);
            }
        }
    } else {
        if (end === 'l' || end === 'L') {
            return numericLiteral.longAST(s.substr(0, s.length - 1), radix);
        } else {
            value = parseInt(tmp, radix);
        }
    }
    if (value > LONG_THRESHOLD && Math.floor(value) === value && (s.indexOf('e') === -1 && s.indexOf('E') === -1)) {
        return numericLiteral.longAST(s, 0);
    }

    if (end === 'l' || end === 'L') {
        return numericLiteral.longAST(s.substr(0, s.length - 1), radix);
    } else {
        if (neg) {
            return numericLiteral.intAST(-value);
        } else {
            return numericLiteral.intAST(value);
        }
    }
}

function astForSlice(c, n) {
    REQ(n, SYM.subscript);

    var ch = CHILD(n, 0);
    var lower = null;
    var upper = null;
    var step = null;
    if (ch.type === TOK.T_DOT)
        return new astnodes.Ellipsis();
    if (NCH(n) === 1 && ch.type === SYM.IfExpr)
        return new astnodes.Index(astForExpr(c, ch));
    if (ch.type === SYM.IfExpr)
        lower = astForExpr(c, ch);
    if (ch.type === TOK.T_COLON) {
        if (NCH(n) > 1) {
            var n2 = CHILD(n, 1);
            if (n2.type === SYM.IfExpr)
                upper = astForExpr(c, n2);
        }
    } else if (NCH(n) > 2) {
        var n2 = CHILD(n, 2);
        if (n2.type === SYM.IfExpr)
            upper = astForExpr(c, n2);
    }

    ch = CHILD(n, NCH(n) - 1);
    if (ch.type === SYM.sliceop) {
        if (NCH(ch) === 1) {
            ch = CHILD(ch, 0);
            step = new astnodes.Name(strobj("None"), astnodes.Load, ch.lineno, ch.col_offset);
        } else {
            ch = CHILD(ch, 1);
            if (ch.type === SYM.IfExpr)
                step = astForExpr(c, ch);
        }
    }
    return new astnodes.Slice(lower, upper, step);
}

function astForAtomExpr(c, n) {
    var ch = CHILD(n, 0);
    switch (ch.type) {
        case TOK.T_NAME:
            return new astnodes.Name(strobj(ch.value), astnodes.Load, n.lineno, n.col_offset);
        case TOK.T_STRING:
            return new astnodes.Str(parsestrplus(c, n), n.lineno, n.col_offset);
        case TOK.T_NUMBER:
            return new astnodes.Num(parsenumber(c, ch.value, n.lineno), n.lineno, n.col_offset);
        case TOK.T_LPAR:
            ch = CHILD(n, 1);
            if (ch.type === TOK.T_RPAR)
                return new astnodes.Tuple([], astnodes.Load, n.lineno, n.col_offset);
            if (ch.type === SYM.YieldExpr)
                return astForExpr(c, ch);
            if (NCH(ch) > 1 && CHILD(ch, 1).type === SYM.gen_for)
                return astForGenexp(c, ch);
            return astForTestlistGexp(c, ch);
        case TOK.T_LSQB:
            ch = CHILD(n, 1);
            if (ch.type === TOK.T_RSQB)
                return new astnodes.List([], astnodes.Load, n.lineno, n.col_offset);
            REQ(ch, SYM.listmaker);
            if (NCH(ch) === 1 || CHILD(ch, 1).type === TOK.T_COMMA)
                return new astnodes.List(seqForTestlist(c, ch), astnodes.Load, n.lineno, n.col_offset);
            else
                return astForListcomp(c, ch);
        case TOK.T_LBRACE:
            ch = CHILD(n, 1);
            var size = Math.floor((NCH(ch) + 1) / 4);
            var keys = [];
            var values = [];
            for (var i = 0; i < NCH(ch); i += 4) {
                keys[i / 4] = astForExpr(c, CHILD(ch, i));
                values[i / 4] = astForExpr(c, CHILD(ch, i + 2));
            }
            return new astnodes.Dict(keys, values, n.lineno, n.col_offset);
        case TOK.T_BACKQUOTE:
            throw syntaxError("backquote not supported, use repr()", c.c_filename, n.lineno);
        default:
            asserts.fail("unhandled atom", ch.type);
    }
}

function astForPowerExpr(c, n) {
    REQ(n, SYM.PowerExpr);
    var e = astForAtomExpr(c, CHILD(n, 0));
    if (NCH(n) === 1)
        return e;
    for (var i = 1; i < NCH(n); ++i) {
        var ch = CHILD(n, i);
        if (ch.type !== SYM.trailer)
            break;
        var tmp = astForTrailer(c, ch, e);
        tmp.lineno = e.lineno;
        tmp.col_offset = e.col_offset;
        e = tmp;
    }
    if (CHILD(n, NCH(n) - 1).type === SYM.UnaryExpr) {
        var f = astForExpr(c, CHILD(n, NCH(n) - 1));
        e = new astnodes.BinOp(e, astnodes.Pow, f, n.lineno, n.col_offset);
    }
    return e;
}

function astForExpr(c, n) {
    LOOP:
    while (true) {
        switch (n.type) {
            case SYM.IfExpr:
            case SYM.old_test:
                if (CHILD(n, 0).type === SYM.LambdaExpr || CHILD(n, 0).type === SYM.old_LambdaExpr)
                    return astForLambdef(c, CHILD(n, 0));
                else if (NCH(n) > 1)
                    return astForIfexpr(c, n);

            case SYM.OrExpr:
            case SYM.AndExpr:
                if (NCH(n) === 1) {
                    n = CHILD(n, 0);
                    continue LOOP;
                }
                var seq = [];
                for (var i = 0; i < NCH(n); i += 2)
                    seq[i / 2] = astForExpr(c, CHILD(n, i));
                if (CHILD(n, 1).value === "and")
                    return new astnodes.BoolOp(astnodes.And, seq, n.lineno, n.col_offset);
                asserts.assert(CHILD(n, 1).value === "or");
                return new astnodes.BoolOp(astnodes.Or, seq, n.lineno, n.col_offset);
            case SYM.NotExpr:
                if (NCH(n) === 1) {
                    n = CHILD(n, 0);
                    continue LOOP;
                } else {
                    return new astnodes.UnaryOp(astnodes.Not, astForExpr(c, CHILD(n, 1)), n.lineno, n.col_offset);
                }
            case SYM.ComparisonExpr:
                if (NCH(n) === 1) {
                    n = CHILD(n, 0);
                    continue LOOP;
                } else {
                    var ops = [];
                    var cmps = [];
                    for (var i = 1; i < NCH(n); i += 2) {
                        ops[(i - 1) / 2] = astForCompOp(c, CHILD(n, i));
                        cmps[(i - 1) / 2] = astForExpr(c, CHILD(n, i + 1));
                    }
                    return new astnodes.Compare(astForExpr(c, CHILD(n, 0)), ops, cmps, n.lineno, n.col_offset);
                }
            case SYM.ArithmeticExpr:
            case SYM.GeometricExpr:
            case SYM.ShiftExpr:
            case SYM.BitwiseOrExpr:
            case SYM.BitwiseXorExpr:
            case SYM.BitwiseAndExpr:
                if (NCH(n) === 1) {
                    n = CHILD(n, 0);
                    continue LOOP;
                }
                return astForBinop(c, n);
            case SYM.YieldExpr:
                var exp = null;
                if (NCH(n) === 2) {
                    exp = astForTestlist(c, CHILD(n, 1));
                }
                return new astnodes.Yield(exp, n.lineno, n.col_offset);
            case SYM.UnaryExpr:
                if (NCH(n) === 1) {
                    n = CHILD(n, 0);
                    continue LOOP;
                }
                return astForUnaryExpr(c, n);
            case SYM.PowerExpr:
                return astForPowerExpr(c, n);
            default:
                asserts.fail("unhandled expr", "n.type: %d", n.type);
        }
        break;
    }
}

function astForPrintStmt(c, n) {
    var start = 1;
    var dest = null;
    REQ(n, SYM.print_stmt);
    if (NCH(n) >= 2 && CHILD(n, 1).type === TOK.T_RIGHTSHIFT) {
        dest = astForExpr(c, CHILD(n, 2));
        start = 4;
    }
    var seq = [];
    for (var i = start, j = 0; i < NCH(n); i += 2, ++j) {
        seq[j] = astForExpr(c, CHILD(n, i));
    }
    var nl = (CHILD(n, NCH(n) - 1)).type === TOK.T_COMMA ? false : true;
    return new astnodes.Print(dest, seq, nl, n.lineno, n.col_offset);
}

function astForStmt(c, n) {
    if (n.type === SYM.stmt) {
        asserts.assert(NCH(n) === 1);
        n = CHILD(n, 0);
    }
    if (n.type === SYM.simple_stmt) {
        asserts.assert(numStmts(n) === 1);
        n = CHILD(n, 0);
    }
    if (n.type === SYM.small_stmt) {
        REQ(n, SYM.small_stmt);
        n = CHILD(n, 0);
        switch (n.type) {
            case SYM.ExprStmt:
                return astForExprStmt(c, n);
            case SYM.print_stmt:
                return astForPrintStmt(c, n);
            case SYM.del_stmt:
                return astForDelStmt(c, n);
            case SYM.pass_stmt:
                return new astnodes.Pass(n.lineno, n.col_offset);
            case SYM.flow_stmt:
                return astForFlowStmt(c, n);
            case SYM.import_stmt:
                return astForImportStmt(c, n);
            case SYM.GlobalStmt:
                return astForGlobalStmt(c, n);
            case SYM.NonLocalStmt:
                return astForNonLocalStmt(c, n);
            case SYM.exec_stmt:
                return astForExecStmt(c, n);
            case SYM.assert_stmt:
                return astForAssertStmt(c, n);
            default:
                asserts.fail("unhandled small_stmt");
        }
    } else {
        var ch = CHILD(n, 0);
        REQ(n, SYM.compound_stmt);
        switch (ch.type) {
            case SYM.if_stmt:
                return astForIfStmt(c, ch);
            case SYM.while_stmt:
                return astForWhileStmt(c, ch);
            case SYM.for_stmt:
                return astForForStmt(c, ch);
            case SYM.try_stmt:
                return astForTryStmt(c, ch);
            case SYM.with_stmt:
                return astForWithStmt(c, ch);
            case SYM.funcdef:
                return astForFuncdef(c, ch, []);
            case SYM.classdef:
                return astForClassdef(c, ch, []);
            case SYM.decorated:
                return astForDecorated(c, ch);
            default:
                asserts.assert("unhandled compound_stmt");
        }
    }
}

function astFromParse(n, filename) {
    var c = new Compiling("utf-8", filename);

    var stmts = [];
    var ch;
    var k = 0;
    switch (n.type) {
        case SYM.file_input:
            for (var i = 0; i < NCH(n) - 1; ++i) {
                var ch = CHILD(n, i);
                if (n.type === TOK.T_NEWLINE)
                    continue;
                REQ(ch, SYM.stmt);
                var num = numStmts(ch);
                if (num === 1) {
                    stmts[k++] = astForStmt(c, ch);
                } else {
                    ch = CHILD(ch, 0);
                    REQ(ch, SYM.simple_stmt);
                    for (var j = 0; j < num; ++j) {
                        stmts[k++] = astForStmt(c, CHILD(ch, j * 2));
                    }
                }
            }
            return new astnodes.Module(stmts);
        case SYM.eval_input:
            asserts.fail("todo;");
        case SYM.single_input:
            asserts.fail("todo;");
        default:
            asserts.fail("todo;");
    }
}
exports.astFromParse = astFromParse;
function astDump(node) {
    var _format = function (node) {
        if (node === null) {
            return "None";
        } else if (node.prototype && node.prototype._astname !== undefined && node.prototype._isenum) {
            return node.prototype._astname + "()";
        } else if (node._astname !== undefined) {
            var fields = [];
            for (var i = 0; i < node._fields.length; i += 2) {
                var a = node._fields[i];
                var b = node._fields[i + 1](node);
                fields.push([a, _format(b)]);
            }
            var attrs = [];
            for (var i = 0; i < fields.length; ++i) {
                var field = fields[i];
                attrs.push(field[0] + "=" + field[1].replace(/^\s+/, ''));
            }
            var fieldstr = attrs.join(',');
            return node._astname + "(" + fieldstr + ")";
        } else if (base.isArrayLike(node)) {
            var elems = [];
            for (var i = 0; i < node.length; ++i) {
                var x = node[i];
                elems.push(_format(x));
            }
            var elemsstr = elems.join(',');
            return "[" + elemsstr.replace(/^\s+/, '') + "]";
        } else {
            var ret;
            if (node === true)
                ret = "True";
            else if (node === false)
                ret = "False";
            else
                ret = "" + node;
            return ret;
        }
    };

    var visitNode = function (node) {
        switch (node.constructor) {
            case astnodes.Module:
                 {
                    var module = node;
                    return "Module(body=" + visitStmts(module.body) + ")";
                }
                break;
            default: {
            }
        }
    };

    var visitStmts = function (stmts) {
        return "[" + stmts.map(function (stmt) {
            return visitStmt(stmt);
        }).join(', ') + "]";
    };

    var visitStmt = function (stmt) {
        switch (stmt.constructor) {
            case astnodes.FunctionDef:
                 {
                    var functionDef = stmt;
                    return "FunctionDef(name=" + functionDef.name + ", lineno=" + functionDef.lineno + ", col_offset=" + functionDef.col_offset + ", body=" + visitStmts(functionDef.body) + ")";
                }
                break;
            case astnodes.Assign: {
                var assign = stmt;
                return "Assign(targets=" + visitExprs(assign.targets) + ", value=" + visitExpr(assign.value) + ", lineno=" + assign.lineno + ", col_offset=" + assign.col_offset + ")";
            }
            case astnodes.Pass:
                 {
                    var pass = stmt;
                    return "Pass()";
                }
                break;
            default: {
            }
        }
    };

    var visitExprs = function (exprs) {
        return "[" + exprs.map(function (expr) {
            return visitExpr(expr);
        }).join(', ') + "]";
    };

    var visitExpr = function (expr) {
        switch (expr.constructor) {
            case astnodes.Name:
                 {
                    var name = expr;
                    return "Name(id=" + name.id + ", lineno=" + name.lineno + ", col_offset=" + name.col_offset + ")";
                }
                break;
            case astnodes.Num:
                 {
                    var num = expr;
                    return "Num()";
                }
                break;
            default: {
            }
        }
    };

    return visitNode(node);
}
exports.astDump = astDump;
});

ace.define("ace/mode/python/symtable",["require","exports","module","ace/mode/python/astnodes","ace/mode/python/base","ace/mode/python/asserts"], function(require, exports, module) {
"no use strict";
var astnodes = require('./astnodes');
var base = require('./base');
var asserts = require('./asserts');
var DEF_GLOBAL = 1;
var DEF_LOCAL = 2;
var DEF_PARAM = 2 << 1;
var USE = 2 << 2;
var DEF_STAR = 2 << 3;
var DEF_DOUBLESTAR = 2 << 4;
var DEF_INTUPLE = 2 << 5;
var DEF_FREE = 2 << 6;
var DEF_FREE_GLOBAL = 2 << 7;
var DEF_FREE_CLASS = 2 << 8;
var DEF_IMPORT = 2 << 9;

var DEF_BOUND = (DEF_LOCAL | DEF_PARAM | DEF_IMPORT);
var SCOPE_OFF = 11;
var SCOPE_MASK = 7;

exports.LOCAL = 1;
exports.GLOBAL_EXPLICIT = 2;
exports.GLOBAL_IMPLICIT = 3;
exports.FREE = 4;
exports.CELL = 5;
var OPT_IMPORT_STAR = 1;
var OPT_EXEC = 2;
var OPT_BARE_EXEC = 4;
var OPT_TOPLEVEL = 8;

var GENERATOR = 2;
var GENERATOR_EXPRESSION = 2;

var ModuleBlock = 'module';
exports.FunctionBlock = 'function';
var ClassBlock = 'class';
function syntaxError(message, fileName, lineNumber) {
    asserts.assert(base.isString(message), "message must be a string");
    asserts.assert(base.isString(fileName), "fileName must be a string");
    if (base.isDef(lineNumber)) {
        asserts.assert(base.isNumber(lineNumber), "lineNumber must be a number");
    }
    var e = new SyntaxError(message);
    e['fileName'] = fileName;
    if (typeof lineNumber === 'number') {
        e['lineNumber'] = lineNumber;
    }
    return e;
}
function mangleName(priv, name) {
    var strpriv = null;

    if (priv === null || name === null || name.charAt(0) !== '_' || name.charAt(1) !== '_')
        return name;
    if (name.charAt(name.length - 1) === '_' && name.charAt(name.length - 2) === '_')
        return name;
    strpriv = priv;
    strpriv.replace(/_/g, '');
    if (strpriv === '')
        return name;

    strpriv = priv;
    strpriv.replace(/^_*/, '');
    strpriv = '_' + strpriv + name;
    return strpriv;
}
exports.mangleName = mangleName;

var Symbol = (function () {
    function Symbol(name, flags, namespaces) {
        this.__name = name;
        this.__flags = flags;
        this.__scope = (flags >> SCOPE_OFF) & SCOPE_MASK;
        this.__namespaces = namespaces || [];
    }
    Symbol.prototype.get_name = function () {
        return this.__name;
    };

    Symbol.prototype.is_referenced = function () {
        return !!(this.__flags & USE);
    };

    Symbol.prototype.is_parameter = function () {
        return !!(this.__flags & DEF_PARAM);
    };

    Symbol.prototype.is_global = function () {
        return this.__scope === exports.GLOBAL_IMPLICIT || this.__scope == exports.GLOBAL_EXPLICIT;
    };

    Symbol.prototype.is_declared_global = function () {
        return this.__scope == exports.GLOBAL_EXPLICIT;
    };

    Symbol.prototype.is_local = function () {
        return !!(this.__flags & DEF_BOUND);
    };

    Symbol.prototype.is_free = function () {
        return this.__scope == exports.FREE;
    };

    Symbol.prototype.is_imported = function () {
        return !!(this.__flags & DEF_IMPORT);
    };

    Symbol.prototype.is_assigned = function () {
        return !!(this.__flags & DEF_LOCAL);
    };

    Symbol.prototype.is_namespace = function () {
        return this.__namespaces && this.__namespaces.length > 0;
    };

    Symbol.prototype.get_namespaces = function () {
        return this.__namespaces;
    };
    return Symbol;
})();

var astScopeCounter = 0;

var SymbolTableScope = (function () {
    function SymbolTableScope(table, name, type, ast, lineno) {
        this.symFlags = {};
        this.name = name;
        this.varnames = [];
        this.children = [];
        this.blockType = type;

        this.isNested = false;
        this.hasFree = false;
        this.childHasFree = false; // true if child block has free vars including free refs to globals
        this.generator = false;
        this.varargs = false;
        this.varkeywords = false;
        this.returnsValue = false;

        this.lineno = lineno;

        this.table = table;

        if (table.cur && (table.cur.is_nested() || table.cur.blockType === exports.FunctionBlock))
            this.isNested = true;

        ast.scopeId = astScopeCounter++;
        table.stss[ast.scopeId] = this;
        this.symbols = {};
    }
    SymbolTableScope.prototype.get_type = function () {
        return this.blockType;
    };

    SymbolTableScope.prototype.get_name = function () {
        return this.name;
    };

    SymbolTableScope.prototype.get_lineno = function () {
        return this.lineno;
    };

    SymbolTableScope.prototype.is_nested = function () {
        return this.isNested;
    };

    SymbolTableScope.prototype.has_children = function () {
        return this.children.length > 0;
    };

    SymbolTableScope.prototype.get_identifiers = function () {
        return this._identsMatching(function (x) {
            return true;
        });
    };

    SymbolTableScope.prototype.lookup = function (name) {
        var sym;
        if (!this.symbols.hasOwnProperty(name)) {
            var flags = this.symFlags[name];
            var namespaces = this.__check_children(name);
            sym = this.symbols[name] = new Symbol(name, flags, namespaces);
        } else {
            sym = this.symbols[name];
        }
        return sym;
    };

    SymbolTableScope.prototype.__check_children = function (name) {
        var ret = [];
        for (var i = 0; i < this.children.length; ++i) {
            var child = this.children[i];
            if (child.name === name)
                ret.push(child);
        }
        return ret;
    };

    SymbolTableScope.prototype._identsMatching = function (f) {
        var ret = [];
        for (var k in this.symFlags) {
            if (this.symFlags.hasOwnProperty(k)) {
                if (f(this.symFlags[k]))
                    ret.push(k);
            }
        }
        ret.sort();
        return ret;
    };

    SymbolTableScope.prototype.get_parameters = function () {
        asserts.assert(this.get_type() == 'function', "get_parameters only valid for function scopes");
        if (!this._funcParams)
            this._funcParams = this._identsMatching(function (x) {
                return x & DEF_PARAM;
            });
        return this._funcParams;
    };

    SymbolTableScope.prototype.get_locals = function () {
        asserts.assert(this.get_type() == 'function', "get_locals only valid for function scopes");
        if (!this._funcLocals)
            this._funcLocals = this._identsMatching(function (x) {
                return x & DEF_BOUND;
            });
        return this._funcLocals;
    };

    SymbolTableScope.prototype.get_globals = function () {
        asserts.assert(this.get_type() == 'function', "get_globals only valid for function scopes");
        if (!this._funcGlobals) {
            this._funcGlobals = this._identsMatching(function (x) {
                var masked = (x >> SCOPE_OFF) & SCOPE_MASK;
                return masked == exports.GLOBAL_IMPLICIT || masked == exports.GLOBAL_EXPLICIT;
            });
        }
        return this._funcGlobals;
    };

    SymbolTableScope.prototype.get_frees = function () {
        asserts.assert(this.get_type() == 'function', "get_frees only valid for function scopes");
        if (!this._funcFrees) {
            this._funcFrees = this._identsMatching(function (x) {
                var masked = (x >> SCOPE_OFF) & SCOPE_MASK;
                return masked == exports.FREE;
            });
        }
        return this._funcFrees;
    };

    SymbolTableScope.prototype.get_methods = function () {
        asserts.assert(this.get_type() == 'class', "get_methods only valid for class scopes");
        if (!this._classMethods) {
            var all = [];
            for (var i = 0; i < this.children.length; ++i)
                all.push(this.children[i].name);
            all.sort();
            this._classMethods = all;
        }
        return this._classMethods;
    };

    SymbolTableScope.prototype.getScope = function (name) {
        var v = this.symFlags[name];
        if (v === undefined)
            return 0;
        return (v >> SCOPE_OFF) & SCOPE_MASK;
    };
    return SymbolTableScope;
})();
exports.SymbolTableScope = SymbolTableScope;

var SymbolTable = (function () {
    function SymbolTable(fileName) {
        this.cur = null;
        this.top = null;
        this.stack = [];
        this.global = null;
        this.curClass = null;
        this.tmpname = 0;
        this.stss = {};
        this.fileName = fileName;
    }
    SymbolTable.prototype.getStsForAst = function (ast) {
        asserts.assert(ast.scopeId !== undefined, "ast wasn't added to st?");
        var v = this.stss[ast.scopeId];
        asserts.assert(v !== undefined, "unknown sym tab entry");
        return v;
    };

    SymbolTable.prototype.SEQStmt = function (nodes) {
        var len = nodes.length;
        for (var i = 0; i < len; ++i) {
            var val = nodes[i];
            if (val)
                this.visitStmt(val);
        }
    };

    SymbolTable.prototype.SEQExpr = function (nodes) {
        var len = nodes.length;
        for (var i = 0; i < len; ++i) {
            var val = nodes[i];
            if (val)
                this.visitExpr(val);
        }
    };

    SymbolTable.prototype.enterBlock = function (name, blockType, ast, lineno) {
        var prev = null;
        if (this.cur) {
            prev = this.cur;
            this.stack.push(this.cur);
        }
        this.cur = new SymbolTableScope(this, name, blockType, ast, lineno);
        if (name === 'top') {
            this.global = this.cur.symFlags;
        }
        if (prev) {
            prev.children.push(this.cur);
        }
    };

    SymbolTable.prototype.exitBlock = function () {
        this.cur = null;
        if (this.stack.length > 0)
            this.cur = this.stack.pop();
    };

    SymbolTable.prototype.visitParams = function (args, toplevel) {
        for (var i = 0; i < args.length; ++i) {
            var arg = args[i];
            if (arg.constructor === astnodes.Name) {
                asserts.assert(arg.ctx === astnodes.Param || (arg.ctx === astnodes.Store && !toplevel));
                this.addDef(arg.id, DEF_PARAM, arg.lineno);
            } else {
                throw syntaxError("invalid expression in parameter list", this.fileName);
            }
        }
    };
    SymbolTable.prototype.visitArguments = function (a, lineno) {
        if (a.args)
            this.visitParams(a.args, true);
        if (a.vararg) {
            this.addDef(a.vararg, DEF_PARAM, lineno);
            this.cur.varargs = true;
        }
        if (a.kwarg) {
            this.addDef(a.kwarg, DEF_PARAM, lineno);
            this.cur.varkeywords = true;
        }
    };
    SymbolTable.prototype.newTmpname = function (lineno) {
        this.addDef("_[" + (++this.tmpname) + "]", DEF_LOCAL, lineno);
    };
    SymbolTable.prototype.addDef = function (name, flag, lineno) {
        var mangled = exports.mangleName(this.curClass, name);
        var val = this.cur.symFlags[mangled];
        if (val !== undefined) {
            if ((flag & DEF_PARAM) && (val & DEF_PARAM)) {
                throw syntaxError("duplicate argument '" + name + "' in function definition", this.fileName, lineno);
            }
            val |= flag;
        } else {
            val = flag;
        }
        this.cur.symFlags[mangled] = val;
        if (flag & DEF_PARAM) {
            this.cur.varnames.push(mangled);
        } else if (flag & DEF_GLOBAL) {
            val = flag;
            var fromGlobal = this.global[mangled];
            if (fromGlobal !== undefined)
                val |= fromGlobal;
            this.global[mangled] = val;
        }
    };

    SymbolTable.prototype.visitSlice = function (s) {
        switch (s.constructor) {
            case astnodes.Slice:
                if (s.lower)
                    this.visitExpr(s.lower);
                if (s.upper)
                    this.visitExpr(s.upper);
                if (s.step)
                    this.visitExpr(s.step);
                break;
            case astnodes.ExtSlice:
                for (var i = 0; i < s.dims.length; ++i)
                    this.visitSlice(s.dims[i]);
                break;
            case astnodes.Index:
                this.visitExpr(s.value);
                break;
            case astnodes.Ellipsis:
                break;
        }
    };
    SymbolTable.prototype.visitStmt = function (s) {
        asserts.assert(s !== undefined, "visitStmt called with undefined");
        switch (s.constructor) {
            case astnodes.FunctionDef:
                this.addDef(s.name, DEF_LOCAL, s.lineno);
                if (s.args.defaults)
                    this.SEQExpr(s.args.defaults);
                if (s.decorator_list)
                    this.SEQExpr(s.decorator_list);
                this.enterBlock(s.name, exports.FunctionBlock, s, s.lineno);
                this.visitArguments(s.args, s.lineno);
                this.SEQStmt(s.body);
                this.exitBlock();
                break;
            case astnodes.ClassDef:
                this.addDef(s.name, DEF_LOCAL, s.lineno);
                this.SEQExpr(s.bases);
                if (s.decorator_list)
                    this.SEQExpr(s.decorator_list);
                this.enterBlock(s.name, ClassBlock, s, s.lineno);
                var tmp = this.curClass;
                this.curClass = s.name;
                this.SEQStmt(s.body);
                this.curClass = tmp;
                this.exitBlock();
                break;
            case astnodes.Return_:
                if (s.value) {
                    this.visitExpr(s.value);
                    this.cur.returnsValue = true;
                    if (this.cur.generator) {
                        throw syntaxError("'return' with argument inside generator", this.fileName);
                    }
                }
                break;
            case astnodes.Delete_:
                this.SEQExpr(s.targets);
                break;
            case astnodes.Assign:
                this.SEQExpr(s.targets);
                this.visitExpr(s.value);
                break;
            case astnodes.AugAssign:
                this.visitExpr(s.target);
                this.visitExpr(s.value);
                break;
            case astnodes.Print:
                if (s.dest)
                    this.visitExpr(s.dest);
                this.SEQExpr(s.values);
                break;
            case astnodes.For_:
                this.visitExpr(s.target);
                this.visitExpr(s.iter);
                this.SEQStmt(s.body);
                if (s.orelse)
                    this.SEQStmt(s.orelse);
                break;
            case astnodes.While_:
                this.visitExpr(s.test);
                this.SEQStmt(s.body);
                if (s.orelse)
                    this.SEQStmt(s.orelse);
                break;
            case astnodes.If_:
                this.visitExpr(s.test);
                this.SEQStmt(s.body);
                if (s.orelse)
                    this.SEQStmt(s.orelse);
                break;
            case astnodes.Raise:
                if (s.type) {
                    this.visitExpr(s.type);
                    if (s.inst) {
                        this.visitExpr(s.inst);
                        if (s.tback)
                            this.visitExpr(s.tback);
                    }
                }
                break;
            case astnodes.TryExcept:
                this.SEQStmt(s.body);
                this.SEQStmt(s.orelse);
                this.visitExcepthandlers(s.handlers);
                break;
            case astnodes.TryFinally:
                this.SEQStmt(s.body);
                this.SEQStmt(s.finalbody);
                break;
            case astnodes.Assert:
                this.visitExpr(s.test);
                if (s.msg)
                    this.visitExpr(s.msg);
                break;
            case astnodes.Import_:
            case astnodes.ImportFrom:
                this.visitAlias(s.names, s.lineno);
                break;
            case astnodes.Exec:
                this.visitExpr(s.body);
                if (s.globals) {
                    this.visitExpr(s.globals);
                    if (s.locals)
                        this.visitExpr(s.locals);
                }
                break;
            case astnodes.Global:
                var nameslen = s.names.length;
                for (var i = 0; i < nameslen; ++i) {
                    var name = exports.mangleName(this.curClass, s.names[i]);
                    var cur = this.cur.symFlags[name];
                    if (cur & (DEF_LOCAL | USE)) {
                        if (cur & DEF_LOCAL) {
                            throw syntaxError("name '" + name + "' is assigned to before global declaration", this.fileName, s.lineno);
                        } else {
                            throw syntaxError("name '" + name + "' is used prior to global declaration", this.fileName, s.lineno);
                        }
                    }
                    this.addDef(name, DEF_GLOBAL, s.lineno);
                }
                break;
            case astnodes.Expr:
                this.visitExpr(s.value);
                break;
            case astnodes.Pass:
            case astnodes.Break_:
            case astnodes.Continue_:
                break;
            case astnodes.With_:
                this.newTmpname(s.lineno);
                this.visitExpr(s.context_expr);
                if (s.optional_vars) {
                    this.newTmpname(s.lineno);
                    this.visitExpr(s.optional_vars);
                }
                this.SEQStmt(s.body);
                break;

            default:
                asserts.fail("Unhandled type " + s.constructor.name + " in visitStmt");
        }
    };

    SymbolTable.prototype.visitExpr = function (e) {
        asserts.assert(e !== undefined, "visitExpr called with undefined");

        switch (e.constructor) {
            case astnodes.BoolOp:
                this.SEQExpr(e.values);
                break;
            case astnodes.BinOp:
                this.visitExpr(e.left);
                this.visitExpr(e.right);
                break;
            case astnodes.UnaryOp:
                this.visitExpr(e.operand);
                break;
            case astnodes.Lambda:
                this.addDef("lambda", DEF_LOCAL, e.lineno);
                if (e.args.defaults)
                    this.SEQExpr(e.args.defaults);
                this.enterBlock("lambda", exports.FunctionBlock, e, e.lineno);
                this.visitArguments(e.args, e.lineno);
                this.visitExpr(e.body);
                this.exitBlock();
                break;
            case astnodes.IfExp:
                this.visitExpr(e.test);
                this.visitExpr(e.body);
                this.visitExpr(e.orelse);
                break;
            case astnodes.Dict:
                this.SEQExpr(e.keys);
                this.SEQExpr(e.values);
                break;
            case astnodes.ListComp:
                this.newTmpname(e.lineno);
                this.visitExpr(e.elt);
                this.visitComprehension(e.generators, 0);
                break;
            case astnodes.GeneratorExp:
                this.visitGenexp(e);
                break;
            case astnodes.Yield:
                if (e.value)
                    this.visitExpr(e.value);
                this.cur.generator = true;
                if (this.cur.returnsValue) {
                    throw syntaxError("'return' with argument inside generator", this.fileName);
                }
                break;
            case astnodes.Compare:
                this.visitExpr(e.left);
                this.SEQExpr(e.comparators);
                break;
            case astnodes.Call:
                this.visitExpr(e.func);
                this.SEQExpr(e.args);
                for (var i = 0; i < e.keywords.length; ++i)
                    this.visitExpr(e.keywords[i].value);
                if (e.starargs)
                    this.visitExpr(e.starargs);
                if (e.kwargs)
                    this.visitExpr(e.kwargs);
                break;
            case astnodes.Num:
            case astnodes.Str:
                break;
            case astnodes.Attribute:
                this.visitExpr(e.value);
                break;
            case astnodes.Subscript:
                this.visitExpr(e.value);
                this.visitSlice(e.slice);
                break;
            case astnodes.Name:
                this.addDef(e.id, e.ctx === astnodes.Load ? USE : DEF_LOCAL, e.lineno);
                break;
            case astnodes.List:
            case astnodes.Tuple:
                this.SEQExpr(e.elts);
                break;
            default:
                asserts.fail("Unhandled type " + e.constructor.name + " in visitExpr");
        }
    };

    SymbolTable.prototype.visitComprehension = function (lcs, startAt) {
        var len = lcs.length;
        for (var i = startAt; i < len; ++i) {
            var lc = lcs[i];
            this.visitExpr(lc.target);
            this.visitExpr(lc.iter);
            this.SEQExpr(lc.ifs);
        }
    };
    SymbolTable.prototype.visitAlias = function (names, lineno) {
        for (var i = 0; i < names.length; ++i) {
            var a = names[i];
            var name = a.asname === null ? a.name : a.asname;
            var storename = name;
            var dot = name.indexOf('.');
            if (dot !== -1)
                storename = name.substr(0, dot);
            if (name !== "*") {
                this.addDef(storename, DEF_IMPORT, lineno);
            } else {
                if (this.cur.blockType !== ModuleBlock) {
                    throw syntaxError("import * only allowed at module level", this.fileName);
                }
            }
        }
    };
    SymbolTable.prototype.visitGenexp = function (e) {
        var outermost = e.generators[0];
        this.visitExpr(outermost.iter);
        this.enterBlock("genexpr", exports.FunctionBlock, e, e.lineno);
        this.cur.generator = true;
        this.addDef(".0", DEF_PARAM, e.lineno);
        this.visitExpr(outermost.target);
        this.SEQExpr(outermost.ifs);
        this.visitComprehension(e.generators, 1);
        this.visitExpr(e.elt);
        this.exitBlock();
    };

    SymbolTable.prototype.visitExcepthandlers = function (handlers) {
        for (var i = 0, eh; eh = handlers[i]; ++i) {
            if (eh.type)
                this.visitExpr(eh.type);
            if (eh.name)
                this.visitExpr(eh.name);
            this.SEQStmt(eh.body);
        }
    };
    SymbolTable.prototype.analyzeBlock = function (ste, bound, free, global) {
        var local = {};
        var scope = {};
        var newglobal = {};
        var newbound = {};
        var newfree = {};

        if (ste.blockType == ClassBlock) {
            _dictUpdate(newglobal, global);
            if (bound)
                _dictUpdate(newbound, bound);
        }

        for (var name in ste.symFlags) {
            var flags = ste.symFlags[name];
            this.analyzeName(ste, scope, name, flags, bound, local, free, global);
        }

        if (ste.blockType !== ClassBlock) {
            if (ste.blockType === exports.FunctionBlock)
                _dictUpdate(newbound, local);
            if (bound)
                _dictUpdate(newbound, bound);
            _dictUpdate(newglobal, global);
        }

        var allfree = {};
        var childlen = ste.children.length;
        for (var i = 0; i < childlen; ++i) {
            var c = ste.children[i];
            this.analyzeChildBlock(c, newbound, newfree, newglobal, allfree);
            if (c.hasFree || c.childHasFree)
                ste.childHasFree = true;
        }

        _dictUpdate(newfree, allfree);

        if (ste.blockType === exports.FunctionBlock)
            this.analyzeCells(scope, newfree);

        this.updateSymbols(ste.symFlags, scope, bound, newfree, ste.blockType === ClassBlock);

        _dictUpdate(free, newfree);
    };

    SymbolTable.prototype.analyzeChildBlock = function (entry, bound, free, global, childFree) {
        var tempBound = {};
        _dictUpdate(tempBound, bound);
        var tempFree = {};
        _dictUpdate(tempFree, free);
        var tempGlobal = {};
        _dictUpdate(tempGlobal, global);

        this.analyzeBlock(entry, tempBound, tempFree, tempGlobal);
        _dictUpdate(childFree, tempFree);
    };

    SymbolTable.prototype.analyzeCells = function (scope, free) {
        for (var name in scope) {
            var flags = scope[name];
            if (flags !== exports.LOCAL)
                continue;
            if (free[name] === undefined)
                continue;
            scope[name] = exports.CELL;
            delete free[name];
        }
    };
    SymbolTable.prototype.updateSymbols = function (symbols, scope, bound, free, classflag) {
        for (var name in symbols) {
            var flags = symbols[name];
            var w = scope[name];
            flags |= w << SCOPE_OFF;
            symbols[name] = flags;
        }

        var freeValue = exports.FREE << SCOPE_OFF;
        var pos = 0;
        for (var name in free) {
            var o = symbols[name];
            if (o !== undefined) {
                if (classflag && (o & (DEF_BOUND | DEF_GLOBAL))) {
                    var i = o | DEF_FREE_CLASS;
                    symbols[name] = i;
                }

                continue;
            }
            if (bound[name] === undefined)
                continue;
            symbols[name] = freeValue;
        }
    };
    SymbolTable.prototype.analyzeName = function (ste, dict, name, flags, bound, local, free, global) {
        if (flags & DEF_GLOBAL) {
            if (flags & DEF_PARAM)
                throw syntaxError("name '" + name + "' is local and global", this.fileName, ste.lineno);
            dict[name] = exports.GLOBAL_EXPLICIT;
            global[name] = null;
            if (bound && bound[name] !== undefined)
                delete bound[name];
            return;
        }
        if (flags & DEF_BOUND) {
            dict[name] = exports.LOCAL;
            local[name] = null;
            delete global[name];
            return;
        }

        if (bound && bound[name] !== undefined) {
            dict[name] = exports.FREE;
            ste.hasFree = true;
            free[name] = null;
        } else if (global && global[name] !== undefined) {
            dict[name] = exports.GLOBAL_IMPLICIT;
        } else {
            if (ste.isNested)
                ste.hasFree = true;
            dict[name] = exports.GLOBAL_IMPLICIT;
        }
    };

    SymbolTable.prototype.analyze = function () {
        var free = {};
        var global = {};
        this.analyzeBlock(this.top, null, free, global);
    };
    return SymbolTable;
})();
exports.SymbolTable = SymbolTable;

function _dictUpdate(a, b) {
    for (var kb in b) {
        a[kb] = b[kb];
    }
}
function symbolTable(module, fileName) {
    var ret = new SymbolTable(fileName);

    ret.enterBlock("top", ModuleBlock, module, 0);

    ret.top = ret.cur;

    for (var i = 0; i < module.body.length; ++i) {
        ret.visitStmt(module.body[i]);
    }

    ret.exitBlock();

    ret.analyze();

    return ret;
}
exports.symbolTable = symbolTable;

function dumpSymbolTable(st) {
    var pyBoolStr = function (b) {
        return b ? "True" : "False";
    };

    var pyList = function (l) {
        var ret = [];
        for (var i = 0; i < l.length; ++i) {
            ret.push(l[i]);
        }
        return '[' + ret.join(', ') + ']';
    };

    var getIdents = function (obj, indent) {
        if (indent === undefined)
            indent = "";
        var ret = "";
        ret += indent + "Sym_type: " + obj.get_type() + "\n";
        ret += indent + "Sym_name: " + obj.get_name() + "\n";
        ret += indent + "Sym_lineno: " + obj.get_lineno() + "\n";
        ret += indent + "Sym_nested: " + pyBoolStr(obj.is_nested()) + "\n";
        ret += indent + "Sym_haschildren: " + pyBoolStr(obj.has_children()) + "\n";
        if (obj.get_type() === "class") {
            ret += indent + "Class_methods: " + pyList(obj.get_methods()) + "\n";
        } else if (obj.get_type() === "function") {
            ret += indent + "Func_params: " + pyList(obj.get_parameters()) + "\n";
            ret += indent + "Func_locals: " + pyList(obj.get_locals()) + "\n";
            ret += indent + "Func_globals: " + pyList(obj.get_globals()) + "\n";
            ret += indent + "Func_frees: " + pyList(obj.get_frees()) + "\n";
        }
        ret += indent + "-- Identifiers --\n";
        var objidents = obj.get_identifiers();
        var objidentslen = objidents.length;
        for (var i = 0; i < objidentslen; ++i) {
            var info = obj.lookup(objidents[i]);
            ret += indent + "name: " + info.get_name() + "\n";
            ret += indent + "  is_referenced: " + pyBoolStr(info.is_referenced()) + "\n";
            ret += indent + "  is_imported: " + pyBoolStr(info.is_imported()) + "\n";
            ret += indent + "  is_parameter: " + pyBoolStr(info.is_parameter()) + "\n";
            ret += indent + "  is_global: " + pyBoolStr(info.is_global()) + "\n";
            ret += indent + "  is_declared_global: " + pyBoolStr(info.is_declared_global()) + "\n";
            ret += indent + "  is_local: " + pyBoolStr(info.is_local()) + "\n";
            ret += indent + "  is_free: " + pyBoolStr(info.is_free()) + "\n";
            ret += indent + "  is_assigned: " + pyBoolStr(info.is_assigned()) + "\n";
            ret += indent + "  is_namespace: " + pyBoolStr(info.is_namespace()) + "\n";
            var nss = info.get_namespaces();
            var nsslen = nss.length;
            ret += indent + "  namespaces: [\n";
            var sub = [];
            for (var j = 0; j < nsslen; ++j) {
                var ns = nss[j];
                sub.push(getIdents(ns, indent + "    "));
            }
            ret += sub.join('\n');
            ret += indent + '  ]\n';
        }
        return ret;
    };
    return getIdents(st.top, '');
}
exports.dumpSymbolTable = dumpSymbolTable;
;
});

ace.define("ace/mode/python/compiler",["require","exports","module","ace/mode/python/asserts","ace/mode/python/astnodes","ace/mode/python/builder","ace/mode/python/Parser","ace/mode/python/symtable"], function(require, exports, module) {
"no use strict";
var asserts = require('./asserts');
var astnodes = require('./astnodes');
var builder = require('./builder');
var parser = require('./Parser');
var symtable = require('./symtable');

var LOCAL = symtable.LOCAL;
var GLOBAL_EXPLICIT = symtable.GLOBAL_EXPLICIT;
var GLOBAL_IMPLICIT = symtable.GLOBAL_IMPLICIT;
var FREE = symtable.FREE;
var CELL = symtable.CELL;
var FunctionBlock = symtable.FunctionBlock;
var out;

var gensymcount = 0;

var reservedWords_ = {
    'abstract': true,
    'as': true,
    'boolean': true,
    'break': true,
    'byte': true,
    'case': true,
    'catch': true,
    'char': true,
    'class': true,
    'continue': true,
    'const': true,
    'debugger': true,
    'default': true,
    'delete': true,
    'do': true,
    'double': true,
    'else': true,
    'enum': true,
    'export': true,
    'extends': true,
    'false': true,
    'final': true,
    'finally': true,
    'float': true,
    'for': true,
    'function': true,
    'goto': true,
    'if': true,
    'implements': true,
    'import': true,
    'in': true,
    'instanceof': true,
    'int': true,
    'interface': true,
    'is': true,
    'long': true,
    'namespace': true,
    'native': true,
    'new': true,
    'null': true,
    'package': true,
    'private': true,
    'protected': true,
    'public': true,
    'return': true,
    'short': true,
    'static': true,
    'super': false,
    'switch': true,
    'synchronized': true,
    'this': true,
    'throw': true,
    'throws': true,
    'transient': true,
    'true': true,
    'try': true,
    'typeof': true,
    'use': true,
    'var': true,
    'void': true,
    'volatile': true,
    'while': true,
    'with': true
};

function fixReservedWords(name) {
    if (reservedWords_[name] !== true) {
        return name;
    } else {
        return name + "_$rw$";
    }
}

var reservedNames_ = {
    '__defineGetter__': true,
    '__defineSetter__': true,
    'apply': true,
    'call': true,
    'eval': true,
    'hasOwnProperty': true,
    'isPrototypeOf': true,
    '__lookupGetter__': true,
    '__lookupSetter__': true,
    '__noSuchMethod__': true,
    'propertyIsEnumerable': true,
    'toSource': true,
    'toLocaleString': true,
    'toString': true,
    'unwatch': true,
    'valueOf': true,
    'watch': true,
    'length': true
};

function fixReservedNames(name) {
    if (reservedNames_[name]) {
        return name + "_$rn$";
    } else {
        return name;
    }
}
function mangleName(priv, name) {
    var strpriv = null;

    if (priv === null || name === null || name.charAt(0) !== '_' || name.charAt(1) !== '_')
        return name;
    if (name.charAt(name.length - 1) === '_' && name.charAt(name.length - 2) === '_')
        return name;
    strpriv = priv;
    strpriv.replace(/_/g, '');
    if (strpriv === '')
        return name;

    strpriv = priv;
    strpriv.replace(/^_*/, '');
    return '_' + strpriv + name;
}

var toStringLiteralJS = function (value) {
    var quote = "'";
    if (value.indexOf("'") !== -1 && value.indexOf('"') === -1) {
        quote = '"';
    }
    var len = value.length;
    var ret = quote;
    for (var i = 0; i < len; ++i) {
        var c = value.charAt(i);
        if (c === quote || c === '\\')
            ret += '\\' + c;
        else if (c === '\t')
            ret += '\\t';
        else if (c === '\n')
            ret += '\\n';
        else if (c === '\r')
            ret += '\\r';
        else if (c < ' ' || c >= 0x7f) {
            var ashex = c.charCodeAt(0).toString(16);
            if (ashex.length < 2)
                ashex = "0" + ashex;
            ret += "\\x" + ashex;
        } else
            ret += c;
    }
    ret += quote;
    return ret;
};

var OP_FAST = 0;
var OP_GLOBAL = 1;
var OP_DEREF = 2;
var OP_NAME = 3;
var D_NAMES = 0;
var D_FREEVARS = 1;
var D_CELLVARS = 2;

var CompilerUnit = (function () {
    function CompilerUnit() {
        this.ste = null;
        this.name = null;
        this.private_ = null;
        this.firstlineno = 0;
        this.lineno = 0;
        this.linenoSet = false;
        this.localnames = [];
        this.blocknum = 0;
        this.blocks = [];
        this.curblock = 0;
        this.scopename = null;
        this.prefixCode = '';
        this.varDeclsCode = '';
        this.switchCode = '';
        this.suffixCode = '';
        this.breakBlocks = [];
        this.continueBlocks = [];
        this.exceptBlocks = [];
        this.finallyBlocks = [];
    }
    CompilerUnit.prototype.activateScope = function () {
        var self = this;

        out = function () {
            var b = self.blocks[self.curblock];
            for (var i = 0; i < arguments.length; ++i)
                b.push(arguments[i]);
        };
    };
    return CompilerUnit;
})();

var Compiler = (function () {
    function Compiler(fileName, st, flags, sourceCodeForAnnotation) {
        this.interactive = false;
        this.nestlevel = 0;
        this.u = null;
        this.stack = [];
        this.result = [];
        this.allUnits = [];
        this._gr = function (hint) {
            var rest = [];
            for (var _i = 0; _i < (arguments.length - 1); _i++) {
                rest[_i] = arguments[_i + 1];
            }
            var v = this.gensym(hint);
            out("var ", v, "=");
            for (var i = 1; i < arguments.length; ++i) {
                out(arguments[i]);
            }
            out(";");
            return v;
        };
        this.clistcompgen = function (tmpname, generators, genIndex, elt) {
            var start = this.newBlock('list gen start');
            var skip = this.newBlock('list gen skip');
            var anchor = this.newBlock('list gen anchor');

            var l = generators[genIndex];
            var toiter = this.vexpr(l.iter);
            var iter = this._gr("iter", "Sk.abstr.iter(", toiter, ")");
            this._jump(start);
            this.setBlock(start);
            var nexti = this._gr('next', "Sk.abstr.iternext(", iter, ")");
            this._jumpundef(nexti, anchor); // todo; this should be handled by StopIteration
            var target = this.vexpr(l.target, nexti);

            var n = l.ifs.length;
            for (var i = 0; i < n; ++i) {
                var ifres = this.vexpr(l.ifs[i]);
                this._jumpfalse(ifres, start);
            }

            if (++genIndex < generators.length) {
                this.clistcompgen(tmpname, generators, genIndex, elt);
            }

            if (genIndex >= generators.length) {
                var velt = this.vexpr(elt);
                out(tmpname, ".v.push(", velt, ");");
                this._jump(skip);
                this.setBlock(skip);
            }

            this._jump(start);

            this.setBlock(anchor);

            return tmpname;
        };
        this.fileName = fileName;
        this.st = st;
        this.flags = flags;
        this.source = sourceCodeForAnnotation ? sourceCodeForAnnotation.split("\n") : false;
    }
    Compiler.prototype.getSourceLine = function (lineno) {
        asserts.assert(this.source);
        return this.source[lineno - 1];
    };
    Compiler.prototype.annotateSource = function (ast) {
        if (this.source) {
            out('\n//');
            out('\n// line ', ast.lineno, ':');
            out('\n// ', this.getSourceLine(ast.lineno));
            out('\n// ');
            for (var i = 0; i < ast.col_offset; ++i) {
                out(" ");
            }
            out("^");

            out("\n//");

            out('\nSk.currLineNo = ', ast.lineno, ';Sk.currColNo = ', ast.col_offset, ';');
            out("\nSk.currFilename = '", this.fileName, "';\n\n");
        }
    };

    Compiler.prototype.gensym = function (hint) {
        hint = hint || '';
        hint = '$' + hint;
        hint += gensymcount++;
        return hint;
    };

    Compiler.prototype.niceName = function (roughName) {
        return this.gensym(roughName.replace("<", "").replace(">", "").replace(" ", "_"));
    };
    Compiler.prototype._interruptTest = function () {
        out("if (typeof Sk.execStart === 'undefined') {Sk.execStart=new Date()}");
        out("if (Sk.execLimit !== null && new Date() - Sk.execStart > Sk.execLimit) {throw new Sk.builtin.TimeLimitError(Sk.timeoutMsg())}");
    };

    Compiler.prototype._jumpfalse = function (test, block) {
        var cond = this._gr('jfalse', "(", test, "===false||!Sk.misceval.isTrue(", test, "))");
        this._interruptTest();
        out("if(", cond, "){/*test failed */$blk=", block, ";continue;}");
    };

    Compiler.prototype._jumpundef = function (test, block) {
        this._interruptTest();
        out("if(typeof ", test, " === 'undefined'){$blk=", block, ";continue;}");
    };

    Compiler.prototype._jumptrue = function (test, block) {
        var cond = this._gr('jtrue', "(", test, "===true||Sk.misceval.isTrue(", test, "))");
        this._interruptTest();
        out("if(", cond, "){/*test passed */$blk=", block, ";continue;}");
    };

    Compiler.prototype._jump = function (block) {
        this._interruptTest();
        out("$blk=", block, ";continue;");
    };

    Compiler.prototype.ctupleorlist = function (e, data, tuporlist) {
        asserts.assert(tuporlist === 'tuple' || tuporlist === 'list');
        if (e.ctx === astnodes.Store) {
            for (var i = 0; i < e.elts.length; ++i) {
                this.vexpr(e.elts[i], "Sk.abstr.objectGetItem(" + data + "," + i + ")");
            }
        } else if (e.ctx === astnodes.Load) {
            var items = [];
            for (var i = 0; i < e.elts.length; ++i) {
                items.push(this._gr('elem', this.vexpr(e.elts[i])));
            }
            return this._gr('load' + tuporlist, "new Sk.builtins['", tuporlist, "']([", items, "])");
        }
    };

    Compiler.prototype.cdict = function (e) {
        asserts.assert(e.values.length === e.keys.length);
        var items = [];
        for (var i = 0; i < e.values.length; ++i) {
            var v = this.vexpr(e.values[i]);
            items.push(this.vexpr(e.keys[i]));
            items.push(v);
        }
        return this._gr('loaddict', "new Sk.builtins['dict']([", items, "])");
    };

    Compiler.prototype.clistcomp = function (e) {
        asserts.assert(e instanceof astnodes.ListComp);
        var tmp = this._gr("_compr", "new Sk.builtins['list']([])");
        return this.clistcompgen(tmp, e.generators, 0, e.elt);
    };

    Compiler.prototype.cyield = function (e) {
        if (this.u.ste.blockType !== FunctionBlock)
            throw new SyntaxError("'yield' outside function");
        var val = 'null';
        if (e.value)
            val = this.vexpr(e.value);
        var nextBlock = this.newBlock('after yield');
        out("return [/*resume*/", nextBlock, ",/*ret*/", val, "];");
        this.setBlock(nextBlock);
        return '$gen.gi$sentvalue';
    };

    Compiler.prototype.ccompare = function (e) {
        asserts.assert(e.ops.length === e.comparators.length);
        var cur = this.vexpr(e.left);
        var n = e.ops.length;
        var done = this.newBlock("done");
        var fres = this._gr('compareres', 'null');

        for (var i = 0; i < n; ++i) {
            var rhs = this.vexpr(e.comparators[i]);
            var res = this._gr('compare', "Sk.builtin.bool(Sk.misceval.richCompareBool(", cur, ",", rhs, ",'", e.ops[i].prototype._astname, "'))");
            out(fres, '=', res, ';');
            this._jumpfalse(res, done);
            cur = rhs;
        }
        this._jump(done);
        this.setBlock(done);
        return fres;
    };

    Compiler.prototype.ccall = function (e) {
        var func = this.vexpr(e.func);
        var args = this.vseqexpr(e.args);

        if (e.keywords.length > 0 || e.starargs || e.kwargs) {
            var kwarray = [];
            for (var i = 0; i < e.keywords.length; ++i) {
                kwarray.push("'" + e.keywords[i].arg + "'");
                kwarray.push(this.vexpr(e.keywords[i].value));
            }
            var keywords = "[" + kwarray.join(",") + "]";
            var starargs = "undefined";
            var kwargs = "undefined";
            if (e.starargs)
                starargs = this.vexpr(e.starargs);
            if (e.kwargs)
                kwargs = this.vexpr(e.kwargs);
            return this._gr('call', "Sk.misceval.call(", func, ",", kwargs, ",", starargs, ",", keywords, args.length > 0 ? "," : "", args, ")");
        } else {
            return this._gr('call', "Sk.misceval.callsim(", func, args.length > 0 ? "," : "", args, ")");
        }
    };

    Compiler.prototype.cslice = function (s) {
        asserts.assert(s instanceof astnodes.Slice);
        var low = s.lower ? this.vexpr(s.lower) : 'null';
        var high = s.upper ? this.vexpr(s.upper) : 'null';
        var step = s.step ? this.vexpr(s.step) : 'null';
        return this._gr('slice', "new Sk.builtins['slice'](", low, ",", high, ",", step, ")");
    };

    Compiler.prototype.vslicesub = function (s) {
        var subs;
        switch (s.constructor) {
            case Number:
            case String:
                subs = s;
                break;
            case astnodes.Index:
                subs = this.vexpr(s.value);
                break;
            case astnodes.Slice:
                subs = this.cslice(s);
                break;
            case astnodes.Ellipsis:
            case astnodes.ExtSlice:
                asserts.fail("todo;");
                break;
            default:
                asserts.fail("invalid subscript kind");
        }
        return subs;
    };

    Compiler.prototype.vslice = function (s, ctx, obj, dataToStore) {
        var subs = this.vslicesub(s);
        return this.chandlesubscr(ctx, obj, subs, dataToStore);
    };

    Compiler.prototype.chandlesubscr = function (ctx, obj, subs, data) {
        if (ctx === astnodes.Load || ctx === astnodes.AugLoad)
            return this._gr('lsubscr', "Sk.abstr.objectGetItem(", obj, ",", subs, ")");
        else if (ctx === astnodes.Store || ctx === astnodes.AugStore)
            out("Sk.abstr.objectSetItem(", obj, ",", subs, ",", data, ");");
        else if (ctx === astnodes.Del)
            out("Sk.abstr.objectDelItem(", obj, ",", subs, ");");
        else
            asserts.fail("handlesubscr fail");
    };

    Compiler.prototype.cboolop = function (e) {
        asserts.assert(e instanceof astnodes.BoolOp);
        var jtype;
        var ifFailed;
        if (e.op === astnodes.And)
            jtype = this._jumpfalse;
        else
            jtype = this._jumptrue;
        var end = this.newBlock('end of boolop');
        var s = e.values;
        var n = s.length;
        var retval;
        for (var i = 0; i < n; ++i) {
            var expres = this.vexpr(s[i]);
            if (i === 0) {
                retval = this._gr('boolopsucc', expres);
            }
            out(retval, "=", expres, ";");
            jtype.call(this, expres, end);
        }
        this._jump(end);
        this.setBlock(end);
        return retval;
    };
    Compiler.prototype.vexpr = function (e, data, augstoreval) {
        if (e.lineno > this.u.lineno) {
            this.u.lineno = e.lineno;
            this.u.linenoSet = false;
        }

        switch (e.constructor) {
            case astnodes.BoolOp:
                return this.cboolop(e);
            case astnodes.BinOp:
                return this._gr('binop', "Sk.abstr.numberBinOp(", this.vexpr(e.left), ",", this.vexpr(e.right), ",'", e.op.prototype._astname, "')");
            case astnodes.UnaryOp:
                return this._gr('unaryop', "Sk.abstr.numberUnaryOp(", this.vexpr(e.operand), ",'", e.op.prototype._astname, "')");
            case astnodes.Lambda:
                return this.clambda(e);
            case astnodes.IfExp:
                return this.cifexp(e);
            case astnodes.Dict:
                return this.cdict(e);
            case astnodes.ListComp:
                return this.clistcomp(e);
            case astnodes.GeneratorExp:
                return this.cgenexp(e);
            case astnodes.Yield:
                return this.cyield(e);
            case astnodes.Compare:
                return this.ccompare(e);
            case astnodes.Call:
                var result = this.ccall(e);
                this.annotateSource(e);
                return result;
            case astnodes.Num: {
                if (e.n.isFloat()) {
                    return 'Sk.builtin.numberToPy(' + e.n.value + ')';
                } else if (e.n.isInt()) {
                    return "Sk.ffi.numberToIntPy(" + e.n.value + ")";
                } else if (e.n.isLong()) {
                    return "Sk.ffi.longFromString('" + e.n.text + "', " + e.n.radix + ")";
                }
                asserts.fail("unhandled Num type");
            }
            case astnodes.Str: {
                return this._gr('str', 'Sk.builtin.stringToPy(', toStringLiteralJS(e.s), ')');
            }
            case astnodes.Attribute:
                var val;
                if (e.ctx !== astnodes.AugStore)
                    val = this.vexpr(e.value);
                var mangled = toStringLiteralJS(e.attr);
                mangled = mangled.substring(1, mangled.length - 1);
                mangled = mangleName(this.u.private_, mangled);
                mangled = fixReservedWords(mangled);
                mangled = fixReservedNames(mangled);
                switch (e.ctx) {
                    case astnodes.AugLoad:
                    case astnodes.Load:
                        return this._gr("lattr", "Sk.abstr.gattr(", val, ",'", mangled, "')");
                    case astnodes.AugStore:
                        out("if(typeof ", data, " !== 'undefined'){"); // special case to avoid re-store if inplace worked
                        val = this.vexpr(augstoreval || null); // the || null can never happen, but closure thinks we can get here with it being undef
                        out("Sk.abstr.sattr(", val, ",'", mangled, "',", data, ");");
                        out("}");
                        break;
                    case astnodes.Store:
                        out("Sk.abstr.sattr(", val, ",'", mangled, "',", data, ");");
                        break;
                    case astnodes.Del:
                        asserts.fail("todo;");
                        break;
                    case astnodes.Param:
                    default:
                        asserts.fail("invalid attribute expression");
                }
                break;
            case astnodes.Subscript:
                var val;
                switch (e.ctx) {
                    case astnodes.AugLoad:
                    case astnodes.Load:
                    case astnodes.Store:
                    case astnodes.Del:
                        return this.vslice(e.slice, e.ctx, this.vexpr(e.value), data);
                    case astnodes.AugStore:
                        out("if(typeof ", data, " !== 'undefined'){"); // special case to avoid re-store if inplace worked
                        val = this.vexpr(augstoreval || null); // the || null can never happen, but closure thinks we can get here with it being undef
                        this.vslice(e.slice, e.ctx, val, data);
                        out("}");
                        break;
                    case astnodes.Param:
                    default:
                        asserts.fail("invalid subscript expression");
                }
                break;
            case astnodes.Name:
                return this.nameop(e.id, e.ctx, data);
            case astnodes.List:
                return this.ctupleorlist(e, data, 'list');
            case astnodes.Tuple:
                return this.ctupleorlist(e, data, 'tuple');
            default:
                asserts.fail("unhandled case in vexpr");
        }
    };
    Compiler.prototype.vseqexpr = function (exprs, data) {
        var missingData = (typeof data === 'undefined');

        asserts.assert(missingData || exprs.length === data.length);
        var ret = [];
        for (var i = 0; i < exprs.length; ++i) {
            ret.push(this.vexpr(exprs[i], (missingData ? undefined : data[i])));
        }
        return ret;
    };

    Compiler.prototype.caugassign = function (s) {
        asserts.assert(s instanceof astnodes.AugAssign);
        var e = s.target;
        var auge;
        switch (e.constructor) {
            case astnodes.Attribute:
                auge = new astnodes.Attribute(e.value, e.attr, astnodes.AugLoad, e.lineno, e.col_offset);
                var aug = this.vexpr(auge);
                var val = this.vexpr(s.value);
                var res = this._gr('inplbinopattr', "Sk.abstr.numberInplaceBinOp(", aug, ",", val, ",'", s.op.prototype._astname, "')");
                auge.ctx = astnodes.AugStore;
                return this.vexpr(auge, res, e.value);
            case astnodes.Subscript:
                var augsub = this.vslicesub(e.slice);
                auge = new astnodes.Subscript(e.value, augsub, astnodes.AugLoad, e.lineno, e.col_offset);
                var aug = this.vexpr(auge);
                var val = this.vexpr(s.value);
                var res = this._gr('inplbinopsubscr', "Sk.abstr.numberInplaceBinOp(", aug, ",", val, ",'", s.op.prototype._astname, "')");
                auge.ctx = astnodes.AugStore;
                return this.vexpr(auge, res, e.value);
            case astnodes.Name:
                var to = this.nameop(e.id, astnodes.Load);
                var val = this.vexpr(s.value);
                var res = this._gr('inplbinop', "Sk.abstr.numberInplaceBinOp(", to, ",", val, ",'", s.op.prototype._astname, "')");
                return this.nameop(e.id, astnodes.Store, res);
            default:
                asserts.fail("unhandled case in augassign");
        }
    };
    Compiler.prototype.exprConstant = function (e) {
        switch (e.constructor) {
            case astnodes.Name:

            default:
                return -1;
        }
    };

    Compiler.prototype.newBlock = function (name) {
        var ret = this.u.blocknum++;
        this.u.blocks[ret] = [];
        this.u.blocks[ret]._name = name || '<unnamed>';
        return ret;
    };

    Compiler.prototype.setBlock = function (n) {
        asserts.assert(n >= 0 && n < this.u.blocknum);
        this.u.curblock = n;
    };

    Compiler.prototype.pushBreakBlock = function (n) {
        asserts.assert(n >= 0 && n < this.u.blocknum);
        this.u.breakBlocks.push(n);
    };

    Compiler.prototype.popBreakBlock = function () {
        this.u.breakBlocks.pop();
    };

    Compiler.prototype.pushContinueBlock = function (n) {
        asserts.assert(n >= 0 && n < this.u.blocknum);
        this.u.continueBlocks.push(n);
    };

    Compiler.prototype.popContinueBlock = function () {
        this.u.continueBlocks.pop();
    };

    Compiler.prototype.pushExceptBlock = function (n) {
        asserts.assert(n >= 0 && n < this.u.blocknum);
        this.u.exceptBlocks.push(n);
    };

    Compiler.prototype.popExceptBlock = function () {
        this.u.exceptBlocks.pop();
    };

    Compiler.prototype.pushFinallyBlock = function (n) {
        asserts.assert(n >= 0 && n < this.u.blocknum);
        this.u.finallyBlocks.push(n);
    };

    Compiler.prototype.popFinallyBlock = function () {
        this.u.finallyBlocks.pop();
    };

    Compiler.prototype.setupExcept = function (eb) {
        out("$exc.push(", eb, ");");
    };

    Compiler.prototype.endExcept = function () {
        out("$exc.pop();");
    };

    Compiler.prototype.outputLocals = function (unit) {
        var have = {};
        for (var i = 0; unit.argnames && i < unit.argnames.length; ++i)
            have[unit.argnames[i]] = true;
        unit.localnames.sort();
        var output = [];
        for (var i = 0; i < unit.localnames.length; ++i) {
            var name = unit.localnames[i];
            if (have[name] === undefined) {
                output.push(name);
                have[name] = true;
            }
        }
        if (output.length > 0)
            return "var " + output.join(",") + ";";
        return "";
    };

    Compiler.prototype.outputAllUnits = function () {
        var ret = '';
        for (var j = 0; j < this.allUnits.length; ++j) {
            var unit = this.allUnits[j];
            ret += unit.prefixCode;
            ret += this.outputLocals(unit);
            ret += unit.varDeclsCode;
            ret += unit.switchCode;
            var blocks = unit.blocks;
            for (var i = 0; i < blocks.length; ++i) {
                ret += "case " + i + ": /* --- " + blocks[i]._name + " --- */";
                ret += blocks[i].join('');
            }
            ret += unit.suffixCode;
        }
        return ret;
    };

    Compiler.prototype.cif = function (s) {
        asserts.assert(s instanceof astnodes.If_);
        var constant = this.exprConstant(s.test);
        if (constant === 0) {
            if (s.orelse)
                this.vseqstmt(s.orelse);
        } else if (constant === 1) {
            this.vseqstmt(s.body);
        } else {
            var end = this.newBlock('end of if');
            var next = this.newBlock('next branch of if');

            var test = this.vexpr(s.test);
            this._jumpfalse(test, next);
            this.vseqstmt(s.body);
            this._jump(end);

            this.setBlock(next);
            if (s.orelse)
                this.vseqstmt(s.orelse);
            this._jump(end);
        }
        this.setBlock(end);
    };

    Compiler.prototype.cwhile = function (s) {
        var constant = this.exprConstant(s.test);
        if (constant === 0) {
            if (s.orelse)
                this.vseqstmt(s.orelse);
        } else {
            var top = this.newBlock('while test');
            this._jump(top);
            this.setBlock(top);

            var next = this.newBlock('after while');
            var orelse = s.orelse.length > 0 ? this.newBlock('while orelse') : null;
            var body = this.newBlock('while body');

            this._jumpfalse(this.vexpr(s.test), orelse ? orelse : next);
            this._jump(body);

            this.pushBreakBlock(next);
            this.pushContinueBlock(top);

            this.setBlock(body);
            this.vseqstmt(s.body);
            this._jump(top);

            this.popContinueBlock();
            this.popBreakBlock();

            if (s.orelse.length > 0) {
                this.setBlock(orelse);
                this.vseqstmt(s.orelse);
                this._jump(next);
            }

            this.setBlock(next);
        }
    };

    Compiler.prototype.cfor = function (s) {
        var start = this.newBlock('for start');
        var cleanup = this.newBlock('for cleanup');
        var end = this.newBlock('for end');

        this.pushBreakBlock(end);
        this.pushContinueBlock(start);
        var toiter = this.vexpr(s.iter);
        var iter;
        if (this.u.ste.generator) {
            iter = "$loc." + this.gensym("iter");
            out(iter, "=Sk.abstr.iter(", toiter, ");");
        } else
            iter = this._gr("iter", "Sk.abstr.iter(", toiter, ")");

        this._jump(start);

        this.setBlock(start);
        var nexti = this._gr('next', "Sk.abstr.iternext(", iter, ")");
        this._jumpundef(nexti, cleanup); // todo; this should be handled by StopIteration
        var target = this.vexpr(s.target, nexti);
        this.vseqstmt(s.body);
        this._jump(start);

        this.setBlock(cleanup);
        this.popContinueBlock();
        this.popBreakBlock();

        this.vseqstmt(s.orelse);
        this._jump(end);

        this.setBlock(end);
    };

    Compiler.prototype.craise = function (s) {
        if (s && s.type && s.type.id && (s.type.id === "StopIteration")) {
            out("return undefined;");
        } else {
            var inst = '';
            if (s.inst) {
                inst = this.vexpr(s.inst);
                out("throw ", this.vexpr(s.type), "(", inst, ");");
            } else if (s.type) {
                if (s.type.func) {
                    out("throw ", this.vexpr(s.type), ";");
                } else {
                    out("throw ", this.vexpr(s.type), "('');");
                }
            } else {
                out("throw $err;");
            }
        }
    };

    Compiler.prototype.ctryexcept = function (s) {
        var n = s.handlers.length;
        var handlers = [];
        for (var i = 0; i < n; ++i) {
            handlers.push(this.newBlock("except_" + i + "_"));
        }

        var unhandled = this.newBlock("unhandled");
        var orelse = this.newBlock("orelse");
        var end = this.newBlock("end");

        this.setupExcept(handlers[0]);
        this.vseqstmt(s.body);
        this.endExcept();
        this._jump(orelse);

        for (var i = 0; i < n; ++i) {
            this.setBlock(handlers[i]);
            var handler = s.handlers[i];
            if (!handler.type && i < n - 1) {
                throw new SyntaxError("default 'except:' must be last");
            }

            if (handler.type) {
                var handlertype = this.vexpr(handler.type);
                var next = (i == n - 1) ? unhandled : handlers[i + 1];
                var check = this._gr('instance', "$err instanceof ", handlertype);
                this._jumpfalse(check, next);
            }

            if (handler.name) {
                this.vexpr(handler.name, "$err");
            }
            this.vseqstmt(handler.body);
            this._jump(end);
        }
        this.setBlock(unhandled);
        out("throw $err;");

        this.setBlock(orelse);
        this.vseqstmt(s.orelse);
        this._jump(end);
        this.setBlock(end);
    };

    Compiler.prototype.ctryfinally = function (s) {
        out("/*todo; tryfinally*/");
        this.ctryexcept(s.body[0]);
    };

    Compiler.prototype.cassert = function (s) {
        var test = this.vexpr(s.test);
        var end = this.newBlock("end");
        this._jumptrue(test, end);
        out("throw new Sk.builtin.AssertionError(", s.msg ? this.vexpr(s.msg) : "", ");");
        this.setBlock(end);
    };
    Compiler.prototype.cimportas = function (name, asname, mod) {
        var src = name;
        var dotLoc = src.indexOf(".");
        var cur = mod;
        if (dotLoc !== -1) {
            src = src.substr(dotLoc + 1);
            while (dotLoc !== -1) {
                dotLoc = src.indexOf(".");
                var attr = dotLoc !== -1 ? src.substr(0, dotLoc) : src;
                cur = this._gr('lattr', "Sk.abstr.gattr(", cur, ",'", attr, "')");
                src = src.substr(dotLoc + 1);
            }
        }
        return this.nameop(asname, astnodes.Store, cur);
    };

    Compiler.prototype.cimport = function (s) {
        var n = s.names.length;
        for (var i = 0; i < n; ++i) {
            var alias = s.names[i];
            var mod = this._gr('module', 'Sk.builtin.__import__(', toStringLiteralJS(alias.name), ',$gbl,$loc,[])');

            if (alias.asname) {
                this.cimportas(alias.name, alias.asname, mod);
            } else {
                var lastDot = alias.name.indexOf('.');
                if (lastDot !== -1) {
                    this.nameop(alias.name.substr(0, lastDot), astnodes.Store, mod);
                } else {
                    this.nameop(alias.name, astnodes.Store, mod);
                }
            }
        }
    };

    Compiler.prototype.cfromimport = function (s) {
        var n = s.names.length;
        var names = [];
        for (var i = 0; i < n; ++i) {
            names[i] = s.names[i].name;
        }
        var namesString = names.map(function (name) {
            return toStringLiteralJS(name);
        }).join(', ');
        var mod = this._gr('module', 'Sk.builtin.__import__(', toStringLiteralJS(s.module), ',$gbl,$loc,[', namesString, '])');
        for (var i = 0; i < n; ++i) {
            var alias = s.names[i];
            if (i === 0 && alias.name === "*") {
                asserts.assert(n === 1);
                out("Sk.importStar(", mod, ",$loc, $gbl);");
                return;
            }

            var got = this._gr('item', 'Sk.abstr.gattr(', mod, ',', toStringLiteralJS(alias.name), ')');
            var storeName = alias.name;
            if (alias.asname)
                storeName = alias.asname;
            this.nameop(storeName, astnodes.Store, got);
        }
    };
    Compiler.prototype.buildcodeobj = function (n, coname, decorator_list, args, callback) {
        var decos = [];
        var defaults = [];
        var vararg = null;
        var kwarg = null;
        if (decorator_list)
            decos = this.vseqexpr(decorator_list);
        if (args && args.defaults)
            defaults = this.vseqexpr(args.defaults);
        if (args && args.vararg)
            vararg = args.vararg;
        if (args && args.kwarg)
            kwarg = args.kwarg;
        var containingHasFree = this.u.ste.hasFree;
        var containingHasCell = this.u.ste.childHasFree;
        var scopename = this.enterScope(coname, n, n.lineno);

        var isGenerator = this.u.ste.generator;
        var hasFree = this.u.ste.hasFree;
        var hasCell = this.u.ste.childHasFree;
        var descendantOrSelfHasFree = this.u.ste.hasFree;

        var entryBlock = this.newBlock('codeobj entry');
        this.u.prefixCode = "var " + scopename + "=(function " + this.niceName(coname) + "$(";

        var funcArgs = [];
        if (isGenerator) {
            if (kwarg) {
                throw new SyntaxError(coname + "(): keyword arguments in generators not supported");
            }
            if (vararg) {
                throw new SyntaxError(coname + "(): variable number of arguments in generators not supported");
            }
            funcArgs.push("$gen");
        } else {
            if (kwarg)
                funcArgs.push("$kwa");
            for (var i = 0; args && i < args.args.length; ++i)
                funcArgs.push(this.nameop(args.args[i].id, astnodes.Param));
        }
        if (descendantOrSelfHasFree) {
            funcArgs.push("$free");
        }
        this.u.prefixCode += funcArgs.join(",");

        this.u.prefixCode += "){";

        if (isGenerator)
            this.u.prefixCode += "\n// generator\n";
        if (containingHasFree)
            this.u.prefixCode += "\n// containing has free\n";
        if (containingHasCell)
            this.u.prefixCode += "\n// containing has cell\n";
        if (hasFree)
            this.u.prefixCode += "\n// has free\n";
        if (hasCell)
            this.u.prefixCode += "\n// has cell\n";
        var locals = "{}";
        if (isGenerator) {
            entryBlock = "$gen.gi$resumeat";
            locals = "$gen.gi$locals";
        }
        var cells = "";
        if (hasCell)
            cells = ",$cell={}";
        this.u.varDeclsCode += "var $blk=" + entryBlock + ",$exc=[],$loc=" + locals + cells + ",$gbl=this,$err;";

        for (var i = 0; args && i < args.args.length; ++i) {
            var id = args.args[i].id;
            if (this.isCell(id)) {
                this.u.varDeclsCode += "$cell." + id + "=" + id + ";";
            }
        }
        if (!isGenerator) {
            var minargs = args ? args.args.length - defaults.length : 0;
            var maxargs = vararg ? Infinity : (args ? args.args.length : 0);
            var kw = kwarg ? true : false;
            this.u.varDeclsCode += "Sk.builtin.pyCheckArgs(\"" + coname + "\", arguments, " + minargs + ", " + maxargs + ", " + kw + ", " + descendantOrSelfHasFree + ");";
        }
        if (defaults.length > 0) {
            var offset = args.args.length - defaults.length;
            for (var i = 0; i < defaults.length; ++i) {
                var argname = this.nameop(args.args[i + offset].id, astnodes.Param);
                this.u.varDeclsCode += "if(typeof " + argname + " === 'undefined')" + argname + "=" + scopename + ".$defaults[" + i + "];";
            }
        }
        if (vararg) {
            var start = funcArgs.length;
            this.u.varDeclsCode += vararg + "=new Sk.builtins['tuple'](Array.prototype.slice.call(arguments," + start + "));";
        }
        if (kwarg) {
            this.u.varDeclsCode += kwarg + "=new Sk.builtins['dict']($kwa);";
        }
        this.u.switchCode = "while(true){try{switch($blk){";
        this.u.suffixCode = "}}catch(err){if ($exc.length>0) {$err=err;$blk=$exc.pop();continue;} else {throw err;}}}});";
        callback.call(this, scopename);
        var argnames;
        if (args && args.args.length > 0) {
            var argnamesarr = [];
            for (var i = 0; i < args.args.length; ++i) {
                argnamesarr.push(args.args[i].id);
            }

            argnames = argnamesarr.join("', '");
            this.u.argnames = argnamesarr;
        }
        this.exitScope();
        if (defaults.length > 0)
            out(scopename, ".$defaults=[", defaults.join(','), "];");
        if (argnames) {
            out(scopename, ".co_varnames=['", argnames, "'];");
        }
        if (kwarg) {
            out(scopename, ".co_kwargs=1;");
        }
        var frees = "";
        if (hasFree) {
            frees = ",$cell";
            if (containingHasFree)
                frees += ",$free";
        }
        if (isGenerator)
            if (args && args.args.length > 0) {
                return this._gr("gener", "new Sk.builtins['function']((function(){var $origargs=Array.prototype.slice.call(arguments);Sk.builtin.pyCheckArgs(\"", coname, "\",arguments,", args.args.length - defaults.length, ",", args.args.length, ");return new Sk.builtins['generator'](", scopename, ",$gbl,$origargs", frees, ");}))");
            } else {
                return this._gr("gener", "new Sk.builtins['function']((function(){Sk.builtin.pyCheckArgs(\"", coname, "\",arguments,0,0);return new Sk.builtins['generator'](", scopename, ",$gbl,[]", frees, ");}))");
            }
        else {
            return this._gr("funcobj", "new Sk.builtins['function'](", scopename, ",$gbl", frees, ")");
        }
    };

    Compiler.prototype.cfunction = function (s) {
        asserts.assert(s instanceof astnodes.FunctionDef);
        var funcorgen = this.buildcodeobj(s, s.name, s.decorator_list, s.args, function (scopename) {
            this.vseqstmt(s.body);
            out("return Sk.builtin.none.none$;"); // if we fall off the bottom, we want the ret to be None
        });
        this.nameop(s.name, astnodes.Store, funcorgen);
    };

    Compiler.prototype.clambda = function (e) {
        asserts.assert(e instanceof astnodes.Lambda);
        var func = this.buildcodeobj(e, "<lambda>", null, e.args, function (scopename) {
            var val = this.vexpr(e.body);
            out("return ", val, ";");
        });
        return func;
    };

    Compiler.prototype.cifexp = function (e) {
        var next = this.newBlock('next of ifexp');
        var end = this.newBlock('end of ifexp');
        var ret = this._gr('res', 'null');

        var test = this.vexpr(e.test);
        this._jumpfalse(test, next);

        out(ret, '=', this.vexpr(e.body), ';');
        this._jump(end);

        this.setBlock(next);
        out(ret, '=', this.vexpr(e.orelse), ';');
        this._jump(end);

        this.setBlock(end);
        return ret;
    };

    Compiler.prototype.cgenexpgen = function (generators, genIndex, elt) {
        var start = this.newBlock('start for ' + genIndex);
        var skip = this.newBlock('skip for ' + genIndex);
        var ifCleanup = this.newBlock('if cleanup for ' + genIndex);
        var end = this.newBlock('end for ' + genIndex);

        var ge = generators[genIndex];

        var iter;
        if (genIndex === 0) {
            iter = "$loc.$iter0";
        } else {
            var toiter = this.vexpr(ge.iter);
            iter = "$loc." + this.gensym("iter");
            out(iter, "=", "Sk.abstr.iter(", toiter, ");");
        }
        this._jump(start);
        this.setBlock(start);
        var nexti = this._gr('next', "Sk.abstr.iternext(", iter, ")");
        this._jumpundef(nexti, end); // todo; this should be handled by StopIteration
        var target = this.vexpr(ge.target, nexti);

        var n = ge.ifs.length;
        for (var i = 0; i < n; ++i) {
            var ifres = this.vexpr(ge.ifs[i]);
            this._jumpfalse(ifres, start);
        }

        if (++genIndex < generators.length) {
            this.cgenexpgen(generators, genIndex, elt);
        }

        if (genIndex >= generators.length) {
            var velt = this.vexpr(elt);
            out("return [", skip, "/*resume*/,", velt, "/*ret*/];");
            this.setBlock(skip);
        }

        this._jump(start);

        this.setBlock(end);

        if (genIndex === 1)
            out("return null;");
    };

    Compiler.prototype.cgenexp = function (e) {
        var gen = this.buildcodeobj(e, "<genexpr>", null, null, function (scopename) {
            this.cgenexpgen(e.generators, 0, e.elt);
        });
        var gener = this._gr("gener", "Sk.misceval.callsim(", gen, ");");
        out(gener, ".gi$locals.$iter0=Sk.abstr.iter(", this.vexpr(e.generators[0].iter), ");");
        return gener;
    };

    Compiler.prototype.cclass = function (s) {
        asserts.assert(s instanceof astnodes.ClassDef);
        var decos = s.decorator_list;
        var bases = this.vseqexpr(s.bases);
        var scopename = this.enterScope(s.name, s, s.lineno);
        var entryBlock = this.newBlock('class entry');

        this.u.prefixCode = "var " + scopename + "=(function $" + s.name + "$class_outer($globals,$locals,$rest){var $gbl=$globals,$loc=$locals;";
        this.u.switchCode += "return(function " + s.name + "(){";
        this.u.switchCode += "var $blk=" + entryBlock + ",$exc=[];while(true){switch($blk){";
        this.u.suffixCode = "}break;}}).apply(null,$rest);});";

        this.u.private_ = s.name;

        this.cbody(s.body);
        out("break;");
        this.exitScope();

        var wrapped = this._gr('built', 'Sk.misceval.buildClass($gbl,', scopename, ',', toStringLiteralJS(s.name), ',[', bases, '])');
        this.nameop(s.name, astnodes.Store, wrapped);
    };

    Compiler.prototype.ccontinue = function (s) {
        if (this.u.continueBlocks.length === 0)
            throw new SyntaxError("'continue' outside loop");
        this._jump(this.u.continueBlocks[this.u.continueBlocks.length - 1]);
    };
    Compiler.prototype.vstmt = function (s) {
        this.u.lineno = s.lineno;
        this.u.linenoSet = false;

        this.annotateSource(s);

        switch (s.constructor) {
            case astnodes.FunctionDef:
                this.cfunction(s);
                break;
            case astnodes.ClassDef:
                this.cclass(s);
                break;
            case astnodes.Return_:
                if (this.u.ste.blockType !== FunctionBlock)
                    throw new SyntaxError("'return' outside function");
                if (s.value)
                    out("return ", this.vexpr(s.value), ";");
                else
                    out("return null;");
                break;
            case astnodes.Delete_:
                this.vseqexpr(s.targets);
                break;
            case astnodes.Assign:
                var n = s.targets.length;
                var val = this.vexpr(s.value);
                for (var i = 0; i < n; ++i)
                    this.vexpr(s.targets[i], val);
                break;
            case astnodes.AugAssign:
                return this.caugassign(s);
            case astnodes.Print:
                this.cprint(s);
                break;
            case astnodes.For_:
                return this.cfor(s);
            case astnodes.While_:
                return this.cwhile(s);
            case astnodes.If_:
                return this.cif(s);
            case astnodes.Raise:
                return this.craise(s);
            case astnodes.TryExcept:
                return this.ctryexcept(s);
            case astnodes.TryFinally:
                return this.ctryfinally(s);
            case astnodes.Assert:
                return this.cassert(s);
            case astnodes.Import_:
                return this.cimport(s);
            case astnodes.ImportFrom:
                return this.cfromimport(s);
            case astnodes.Global:
                break;
            case astnodes.Expr:
                this.vexpr(s.value);
                break;
            case astnodes.Pass:
                break;
            case astnodes.Break_:
                if (this.u.breakBlocks.length === 0)
                    throw new SyntaxError("'break' outside loop");
                this._jump(this.u.breakBlocks[this.u.breakBlocks.length - 1]);
                break;
            case astnodes.Continue_:
                this.ccontinue(s);
                break;
            default:
                asserts.fail("unhandled case in vstmt");
        }
    };

    Compiler.prototype.vseqstmt = function (stmts) {
        for (var i = 0; i < stmts.length; ++i)
            this.vstmt(stmts[i]);
    };

    Compiler.prototype.isCell = function (name) {
        var mangled = mangleName(this.u.private_, name);
        var scope = this.u.ste.getScope(mangled);
        var dict = null;
        if (scope === symtable.CELL)
            return true;
        return false;
    };
    Compiler.prototype.nameop = function (name, ctx, dataToStore) {
        if ((ctx === astnodes.Store || ctx === astnodes.AugStore || ctx === astnodes.Del) && name === "__debug__") {
            throw new SyntaxError("can not assign to __debug__");
        }
        if ((ctx === astnodes.Store || ctx === astnodes.AugStore || ctx === astnodes.Del) && name === "None") {
            throw new SyntaxError("can not assign to None");
        }

        if (name === "None")
            return "Sk.builtin.none.none$";
        if (name === "True")
            return "Sk.ffi.bool.True";
        if (name === "False")
            return "Sk.ffi.bool.False";
        var mangled = mangleName(this.u.private_, name);
        var op = 0;
        var optype = OP_NAME;
        var scope = this.u.ste.getScope(mangled);
        var dict = null;
        switch (scope) {
            case FREE:
                dict = "$free";
                optype = OP_DEREF;
                break;
            case CELL:
                dict = "$cell";
                optype = OP_DEREF;
                break;
            case LOCAL:
                if (this.u.ste.blockType === FunctionBlock && !this.u.ste.generator)
                    optype = OP_FAST;
                break;
            case GLOBAL_IMPLICIT:
                if (this.u.ste.blockType === FunctionBlock)
                    optype = OP_GLOBAL;
                break;
            case GLOBAL_EXPLICIT:
                optype = OP_GLOBAL;
            default:
                break;
        }
        mangled = fixReservedNames(mangled);
        mangled = fixReservedWords(mangled);
        asserts.assert(scope || name.charAt(1) === '_');
        var mangledNoPre = mangled;
        if (this.u.ste.generator || this.u.ste.blockType !== FunctionBlock)
            mangled = "$loc." + mangled;
        else if (optype === OP_FAST || optype === OP_NAME)
            this.u.localnames.push(mangled);

        switch (optype) {
            case OP_FAST:
                switch (ctx) {
                    case astnodes.Load:
                    case astnodes.Param:
                        out("if (typeof ", mangled, " === 'undefined') { throw new Error('local variable \\\'", mangled, "\\\' referenced before assignment'); }\n");
                        return mangled;
                    case astnodes.Store:
                        out(mangled, "=", dataToStore, ";");
                        break;
                    case astnodes.Del:
                        out("delete ", mangled, ";");
                        break;
                    default:
                        asserts.fail("unhandled");
                }
                break;
            case OP_NAME:
                switch (ctx) {
                    case astnodes.Load:
                        var v = this.gensym('loadname');
                        out("var ", v, "=(typeof ", mangled, " !== 'undefined') ? ", mangled, ":Sk.misceval.loadname('", mangledNoPre, "',$gbl);");
                        return v;
                    case astnodes.Store:
                        out(mangled, "=", dataToStore, ";");
                        break;
                    case astnodes.Del:
                        out("delete ", mangled, ";");
                        break;
                    case astnodes.Param:
                        return mangled;
                    default:
                        asserts.fail("unhandled");
                }
                break;
            case OP_GLOBAL:
                switch (ctx) {
                    case astnodes.Load:
                        return this._gr("loadgbl", "Sk.misceval.loadname('", mangledNoPre, "',$gbl)");
                    case astnodes.Store:
                        out("$gbl.", mangledNoPre, "=", dataToStore, ';');
                        break;
                    case astnodes.Del:
                        out("delete $gbl.", mangledNoPre);
                        break;
                    default:
                        asserts.fail("unhandled case in name op_global");
                }
                break;
            case OP_DEREF:
                switch (ctx) {
                    case astnodes.Load:
                        return dict + "." + mangledNoPre;
                    case astnodes.Store:
                        out(dict, ".", mangledNoPre, "=", dataToStore, ";");
                        break;
                    case astnodes.Param:
                        return mangledNoPre;
                    default:
                        asserts.fail("unhandled case in name op_deref");
                }
                break;
            default:
                asserts.fail("unhandled case");
        }
    };
    Compiler.prototype.enterScope = function (name, key, lineno) {
        var u = new CompilerUnit();
        u.ste = this.st.getStsForAst(key);
        u.name = name;
        u.firstlineno = lineno;

        if (this.u && this.u.private_)
            u.private_ = this.u.private_;

        this.stack.push(this.u);
        this.allUnits.push(u);
        var scopeName = this.gensym('scope');
        u.scopename = scopeName;

        this.u = u;
        this.u.activateScope();

        this.nestlevel++;

        return scopeName;
    };

    Compiler.prototype.exitScope = function () {
        var prev = this.u;
        this.nestlevel--;
        if (this.stack.length - 1 >= 0)
            this.u = this.stack.pop();
        else
            this.u = null;
        if (this.u)
            this.u.activateScope();

        if (prev.name !== "<module>") {
            var mangled = prev.name;
            mangled = fixReservedWords(mangled);
            mangled = fixReservedNames(mangled);
            out(prev.scopename, ".co_name=Sk.builtin.stringToPy('", mangled, "');");
        }
    };

    Compiler.prototype.cbody = function (stmts) {
        for (var i = 0; i < stmts.length; ++i) {
            this.vstmt(stmts[i]);
        }
    };

    Compiler.prototype.cprint = function (s) {
        asserts.assert(s instanceof astnodes.Print);
        var dest = 'null';
        if (s.dest) {
            dest = this.vexpr(s.dest);
        }

        var n = s.values.length;
        for (var i = 0; i < n; ++i) {
            out("Sk.misceval.print_(Sk.ffi.remapToJs(new Sk.builtins.str(", this.vexpr(s.values[i]), ")));");
        }
        if (s.nl) {
            out("Sk.misceval.print_('\\n');");
        }
    };

    Compiler.prototype.cmod = function (mod) {
        var modf = this.enterScope("<module>", mod, 0);

        var entryBlock = this.newBlock('module entry');
        this.u.prefixCode = "var " + modf + "=(function($modname){";
        this.u.varDeclsCode = "var $blk=" + entryBlock + ",$exc=[],$gbl={},$loc=$gbl,$err;$gbl.__name__=$modname;Sk.globals=$gbl;";

        this.u.switchCode = "try {while(true){try{switch($blk){";
        this.u.suffixCode = "}}catch(err){if ($exc.length>0) {$err=err;$blk=$exc.pop();continue;} else {throw err;}}}}catch(err){if (err instanceof Sk.builtin.SystemExit && !Sk.throwSystemExit) { Sk.misceval.print_(err.toString() + '\\n'); return $loc; } else { throw err; } } });";

        switch (mod.constructor) {
            case astnodes.Module:
                this.cbody(mod.body);
                out("return $loc;");
                break;
            default:
                asserts.fail("todo; unhandled case in compilerMod");
        }
        this.exitScope();

        this.result.push(this.outputAllUnits());
        return modf;
    };
    return Compiler;
})();
exports.Compiler = Compiler;
function compile(source, fileName) {
    var cst = parser.parse(fileName, source);
    var ast = builder.astFromParse(cst, fileName);
    var st = symtable.symbolTable(ast, fileName);
    var c = new Compiler(fileName, st, 0, source);
    return { 'funcname': c.cmod(ast), 'code': c.result.join('') };
}
exports.compile = compile;
;

function resetCompiler() {
    gensymcount = 0;
}
exports.resetCompiler = resetCompiler;
;
});

var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
ace.define("ace/mode/python_worker",["require","exports","module","ace/lib/oop","ace/worker/mirror","ace/mode/python/Parser","ace/mode/python/builder","ace/mode/python/compiler","ace/mode/python/symtable"], function(require, exports, module) {
"no use strict";
var oop = require('../lib/oop');
var m = require('../worker/mirror');

var prsr = require('../mode/python/Parser');

var bldr = require('../mode/python/builder');
var cmplr = require('../mode/python/compiler');
var symtbl = require('../mode/python/symtable');
var INFO = 'info';
var WARNING = 'warning';
var ERROR = 'error';
var PythonWorker = (function (_super) {
    __extends(PythonWorker, _super);
    function PythonWorker(sender) {
        _super.call(this, sender, 500);

        this.setOptions();
        this.sender.emit('initAfter');
    }
    PythonWorker.prototype.setOptions = function (options) {
        this.options = options || {};
    };

    PythonWorker.prototype.changeOptions = function (newOptions) {
        oop.mixin(this.options, newOptions);
        this.deferredUpdate.schedule(100);
    };

    PythonWorker.prototype.onUpdate = function () {
        var source = this.doc.getValue();

        var annotations = [];

        try  {
            var fileName = '<stdin>';

            var node = prsr.parse(fileName, source);

            var module = bldr.astFromParse(node, fileName);

            var symbolTable = symtbl.symbolTable(module, fileName);

            var compiler = new cmplr.Compiler(fileName, symbolTable, 0, source);

            var compiled = { 'funcname': compiler.cmod(module), 'code': compiler.result.join('') };
        } catch (e) {
            try  {
                annotations.push({
                    row: e.lineNumber - 1,
                    column: e.columnNumber,
                    text: e.message,
                    type: ERROR
                });
            } catch (slippery) {
                console.log(slippery);
            }
        }

        this.sender.emit('syntax', annotations);
    };
    return PythonWorker;
})(m.Mirror);
exports.PythonWorker = PythonWorker;
});

ace.define('ace/lib/es5-shim', ['require', 'exports', 'module'], function(
  require,
  exports,
  module
) {
  function Empty() {}

  if (!Function.prototype.bind) {
    Function.prototype.bind = function bind(that) {
      // .length is 1
      var target = this
      if (typeof target != 'function') {
        throw new TypeError(
          'Function.prototype.bind called on incompatible ' + target
        )
      }
      var args = slice.call(arguments, 1) // for normal call
      var bound = function() {
        if (this instanceof bound) {
          var result = target.apply(this, args.concat(slice.call(arguments)))
          if (Object(result) === result) {
            return result
          }
          return this
        } else {
          return target.apply(that, args.concat(slice.call(arguments)))
        }
      }
      if (target.prototype) {
        Empty.prototype = target.prototype
        bound.prototype = new Empty()
        Empty.prototype = null
      }
      return bound
    }
  }
  var call = Function.prototype.call
  var prototypeOfArray = Array.prototype
  var prototypeOfObject = Object.prototype
  var slice = prototypeOfArray.slice
  var _toString = call.bind(prototypeOfObject.toString)
  var owns = call.bind(prototypeOfObject.hasOwnProperty)
  var defineGetter
  var defineSetter
  var lookupGetter
  var lookupSetter
  var supportsAccessors
  if ((supportsAccessors = owns(prototypeOfObject, '__defineGetter__'))) {
    defineGetter = call.bind(prototypeOfObject.__defineGetter__)
    defineSetter = call.bind(prototypeOfObject.__defineSetter__)
    lookupGetter = call.bind(prototypeOfObject.__lookupGetter__)
    lookupSetter = call.bind(prototypeOfObject.__lookupSetter__)
  }
  if ([1, 2].splice(0).length != 2) {
    if (
      (function() {
        // test IE < 9 to splice bug - see issue #138
        function makeArray(l) {
          var a = new Array(l + 2)
          a[0] = a[1] = 0
          return a
        }
        var array = [],
          lengthBefore

        array.splice.apply(array, makeArray(20))
        array.splice.apply(array, makeArray(26))

        lengthBefore = array.length //46
        array.splice(5, 0, 'XXX') // add one element

        lengthBefore + 1 == array.length

        if (lengthBefore + 1 == array.length) {
          return true // has right splice implementation without bugs
        }
      })()
    ) {
      //IE 6/7
      var array_splice = Array.prototype.splice
      Array.prototype.splice = function(start, deleteCount) {
        if (!arguments.length) {
          return []
        } else {
          return array_splice.apply(
            this,
            [
              start === void 0 ? 0 : start,
              deleteCount === void 0 ? this.length - start : deleteCount
            ].concat(slice.call(arguments, 2))
          )
        }
      }
    } else {
      //IE8
      Array.prototype.splice = function(pos, removeCount) {
        var length = this.length
        if (pos > 0) {
          if (pos > length) pos = length
        } else if (pos == void 0) {
          pos = 0
        } else if (pos < 0) {
          pos = Math.max(length + pos, 0)
        }

        if (!(pos + removeCount < length)) removeCount = length - pos

        var removed = this.slice(pos, pos + removeCount)
        var insert = slice.call(arguments, 2)
        var add = insert.length
        if (pos === length) {
          if (add) {
            this.push.apply(this, insert)
          }
        } else {
          var remove = Math.min(removeCount, length - pos)
          var tailOldPos = pos + remove
          var tailNewPos = tailOldPos + add - remove
          var tailCount = length - tailOldPos
          var lengthAfterRemove = length - remove

          if (tailNewPos < tailOldPos) {
            // case A
            for (var i = 0; i < tailCount; ++i) {
              this[tailNewPos + i] = this[tailOldPos + i]
            }
          } else if (tailNewPos > tailOldPos) {
            // case B
            for (i = tailCount; i--; ) {
              this[tailNewPos + i] = this[tailOldPos + i]
            }
          } // else, add == remove (nothing to do)

          if (add && pos === lengthAfterRemove) {
            this.length = lengthAfterRemove // truncate array
            this.push.apply(this, insert)
          } else {
            this.length = lengthAfterRemove + add // reserves space
            for (i = 0; i < add; ++i) {
              this[pos + i] = insert[i]
            }
          }
        }
        return removed
      }
    }
  }
  if (!Array.isArray) {
    Array.isArray = function isArray(obj) {
      return _toString(obj) == '[object Array]'
    }
  }
  var boxedString = Object('a'),
    splitString = boxedString[0] != 'a' || !(0 in boxedString)

  if (!Array.prototype.forEach) {
    Array.prototype.forEach = function forEach(fun /*, thisp*/) {
      var object = toObject(this),
        self =
          splitString && _toString(this) == '[object String]'
            ? this.split('')
            : object,
        thisp = arguments[1],
        i = -1,
        length = self.length >>> 0
      if (_toString(fun) != '[object Function]') {
        throw new TypeError() // TODO message
      }

      while (++i < length) {
        if (i in self) {
          fun.call(thisp, self[i], i, object)
        }
      }
    }
  }
  if (!Array.prototype.map) {
    Array.prototype.map = function map(fun /*, thisp*/) {
      var object = toObject(this),
        self =
          splitString && _toString(this) == '[object String]'
            ? this.split('')
            : object,
        length = self.length >>> 0,
        result = Array(length),
        thisp = arguments[1]
      if (_toString(fun) != '[object Function]') {
        throw new TypeError(fun + ' is not a function')
      }

      for (var i = 0; i < length; i++) {
        if (i in self) result[i] = fun.call(thisp, self[i], i, object)
      }
      return result
    }
  }
  if (!Array.prototype.filter) {
    Array.prototype.filter = function filter(fun /*, thisp */) {
      var object = toObject(this),
        self =
          splitString && _toString(this) == '[object String]'
            ? this.split('')
            : object,
        length = self.length >>> 0,
        result = [],
        value,
        thisp = arguments[1]
      if (_toString(fun) != '[object Function]') {
        throw new TypeError(fun + ' is not a function')
      }

      for (var i = 0; i < length; i++) {
        if (i in self) {
          value = self[i]
          if (fun.call(thisp, value, i, object)) {
            result.push(value)
          }
        }
      }
      return result
    }
  }
  if (!Array.prototype.every) {
    Array.prototype.every = function every(fun /*, thisp */) {
      var object = toObject(this),
        self =
          splitString && _toString(this) == '[object String]'
            ? this.split('')
            : object,
        length = self.length >>> 0,
        thisp = arguments[1]
      if (_toString(fun) != '[object Function]') {
        throw new TypeError(fun + ' is not a function')
      }

      for (var i = 0; i < length; i++) {
        if (i in self && !fun.call(thisp, self[i], i, object)) {
          return false
        }
      }
      return true
    }
  }
  if (!Array.prototype.some) {
    Array.prototype.some = function some(fun /*, thisp */) {
      var object = toObject(this),
        self =
          splitString && _toString(this) == '[object String]'
            ? this.split('')
            : object,
        length = self.length >>> 0,
        thisp = arguments[1]
      if (_toString(fun) != '[object Function]') {
        throw new TypeError(fun + ' is not a function')
      }

      for (var i = 0; i < length; i++) {
        if (i in self && fun.call(thisp, self[i], i, object)) {
          return true
        }
      }
      return false
    }
  }
  if (!Array.prototype.reduce) {
    Array.prototype.reduce = function reduce(fun /*, initial*/) {
      var object = toObject(this),
        self =
          splitString && _toString(this) == '[object String]'
            ? this.split('')
            : object,
        length = self.length >>> 0
      if (_toString(fun) != '[object Function]') {
        throw new TypeError(fun + ' is not a function')
      }
      if (!length && arguments.length == 1) {
        throw new TypeError('reduce of empty array with no initial value')
      }

      var i = 0
      var result
      if (arguments.length >= 2) {
        result = arguments[1]
      } else {
        do {
          if (i in self) {
            result = self[i++]
            break
          }
          if (++i >= length) {
            throw new TypeError('reduce of empty array with no initial value')
          }
        } while (true)
      }

      for (; i < length; i++) {
        if (i in self) {
          result = fun.call(void 0, result, self[i], i, object)
        }
      }

      return result
    }
  }
  if (!Array.prototype.reduceRight) {
    Array.prototype.reduceRight = function reduceRight(fun /*, initial*/) {
      var object = toObject(this),
        self =
          splitString && _toString(this) == '[object String]'
            ? this.split('')
            : object,
        length = self.length >>> 0
      if (_toString(fun) != '[object Function]') {
        throw new TypeError(fun + ' is not a function')
      }
      if (!length && arguments.length == 1) {
        throw new TypeError('reduceRight of empty array with no initial value')
      }

      var result,
        i = length - 1
      if (arguments.length >= 2) {
        result = arguments[1]
      } else {
        do {
          if (i in self) {
            result = self[i--]
            break
          }
          if (--i < 0) {
            throw new TypeError(
              'reduceRight of empty array with no initial value'
            )
          }
        } while (true)
      }

      do {
        if (i in this) {
          result = fun.call(void 0, result, self[i], i, object)
        }
      } while (i--)

      return result
    }
  }
  if (!Array.prototype.indexOf || [0, 1].indexOf(1, 2) != -1) {
    Array.prototype.indexOf = function indexOf(sought /*, fromIndex */) {
      var self =
          splitString && _toString(this) == '[object String]'
            ? this.split('')
            : toObject(this),
        length = self.length >>> 0

      if (!length) {
        return -1
      }

      var i = 0
      if (arguments.length > 1) {
        i = toInteger(arguments[1])
      }
      i = i >= 0 ? i : Math.max(0, length + i)
      for (; i < length; i++) {
        if (i in self && self[i] === sought) {
          return i
        }
      }
      return -1
    }
  }
  if (!Array.prototype.lastIndexOf || [0, 1].lastIndexOf(0, -3) != -1) {
    Array.prototype.lastIndexOf = function lastIndexOf(
      sought /*, fromIndex */
    ) {
      var self =
          splitString && _toString(this) == '[object String]'
            ? this.split('')
            : toObject(this),
        length = self.length >>> 0

      if (!length) {
        return -1
      }
      var i = length - 1
      if (arguments.length > 1) {
        i = Math.min(i, toInteger(arguments[1]))
      }
      i = i >= 0 ? i : length - Math.abs(i)
      for (; i >= 0; i--) {
        if (i in self && sought === self[i]) {
          return i
        }
      }
      return -1
    }
  }
  if (!Object.getPrototypeOf) {
    Object.getPrototypeOf = function getPrototypeOf(object) {
      return (
        object.__proto__ ||
        (object.constructor ? object.constructor.prototype : prototypeOfObject)
      )
    }
  }
  if (!Object.getOwnPropertyDescriptor) {
    var ERR_NON_OBJECT =
      'Object.getOwnPropertyDescriptor called on a ' + 'non-object: '
    Object.getOwnPropertyDescriptor = function getOwnPropertyDescriptor(
      object,
      property
    ) {
      if (
        (typeof object != 'object' && typeof object != 'function') ||
        object === null
      )
        throw new TypeError(ERR_NON_OBJECT + object)
      if (!owns(object, property)) return

      var descriptor, getter, setter
      descriptor = {enumerable: true, configurable: true}
      if (supportsAccessors) {
        var prototype = object.__proto__
        object.__proto__ = prototypeOfObject

        var getter = lookupGetter(object, property)
        var setter = lookupSetter(object, property)
        object.__proto__ = prototype

        if (getter || setter) {
          if (getter) descriptor.get = getter
          if (setter) descriptor.set = setter
          return descriptor
        }
      }
      descriptor.value = object[property]
      return descriptor
    }
  }
  if (!Object.getOwnPropertyNames) {
    Object.getOwnPropertyNames = function getOwnPropertyNames(object) {
      return Object.keys(object)
    }
  }
  if (!Object.create) {
    var createEmpty
    if (Object.prototype.__proto__ === null) {
      createEmpty = function() {
        return {__proto__: null}
      }
    } else {
      createEmpty = function() {
        var empty = {}
        for (var i in empty) empty[i] = null
        empty.constructor = empty.hasOwnProperty = empty.propertyIsEnumerable = empty.isPrototypeOf = empty.toLocaleString = empty.toString = empty.valueOf = empty.__proto__ = null
        return empty
      }
    }

    Object.create = function create(prototype, properties) {
      var object
      if (prototype === null) {
        object = createEmpty()
      } else {
        if (typeof prototype != 'object')
          throw new TypeError(
            'typeof prototype[' + typeof prototype + "] != 'object'"
          )
        var Type = function() {}
        Type.prototype = prototype
        object = new Type()
        object.__proto__ = prototype
      }
      if (properties !== void 0) Object.defineProperties(object, properties)
      return object
    }
  }

  function doesDefinePropertyWork(object) {
    try {
      Object.defineProperty(object, 'sentinel', {})
      return 'sentinel' in object
    } catch (exception) {}
  }
  if (Object.defineProperty) {
    var definePropertyWorksOnObject = doesDefinePropertyWork({})
    var definePropertyWorksOnDom =
      typeof document == 'undefined' ||
      doesDefinePropertyWork(document.createElement('div'))
    if (!definePropertyWorksOnObject || !definePropertyWorksOnDom) {
      var definePropertyFallback = Object.defineProperty
    }
  }

  if (!Object.defineProperty || definePropertyFallback) {
    var ERR_NON_OBJECT_DESCRIPTOR = 'Property description must be an object: '
    var ERR_NON_OBJECT_TARGET = 'Object.defineProperty called on non-object: '
    var ERR_ACCESSORS_NOT_SUPPORTED =
      'getters & setters can not be defined ' + 'on this javascript engine'

    Object.defineProperty = function defineProperty(
      object,
      property,
      descriptor
    ) {
      if (
        (typeof object != 'object' && typeof object != 'function') ||
        object === null
      )
        throw new TypeError(ERR_NON_OBJECT_TARGET + object)
      if (
        (typeof descriptor != 'object' && typeof descriptor != 'function') ||
        descriptor === null
      )
        throw new TypeError(ERR_NON_OBJECT_DESCRIPTOR + descriptor)
      if (definePropertyFallback) {
        try {
          return definePropertyFallback.call(
            Object,
            object,
            property,
            descriptor
          )
        } catch (exception) {}
      }
      if (owns(descriptor, 'value')) {
        if (
          supportsAccessors &&
          (lookupGetter(object, property) || lookupSetter(object, property))
        ) {
          var prototype = object.__proto__
          object.__proto__ = prototypeOfObject
          delete object[property]
          object[property] = descriptor.value
          object.__proto__ = prototype
        } else {
          object[property] = descriptor.value
        }
      } else {
        if (!supportsAccessors) throw new TypeError(ERR_ACCESSORS_NOT_SUPPORTED)
        if (owns(descriptor, 'get'))
          defineGetter(object, property, descriptor.get)
        if (owns(descriptor, 'set'))
          defineSetter(object, property, descriptor.set)
      }

      return object
    }
  }
  if (!Object.defineProperties) {
    Object.defineProperties = function defineProperties(object, properties) {
      for (var property in properties) {
        if (owns(properties, property))
          Object.defineProperty(object, property, properties[property])
      }
      return object
    }
  }
  if (!Object.seal) {
    Object.seal = function seal(object) {
      return object
    }
  }
  if (!Object.freeze) {
    Object.freeze = function freeze(object) {
      return object
    }
  }
  try {
    Object.freeze(function() {})
  } catch (exception) {
    Object.freeze = (function freeze(freezeObject) {
      return function freeze(object) {
        if (typeof object == 'function') {
          return object
        } else {
          return freezeObject(object)
        }
      }
    })(Object.freeze)
  }
  if (!Object.preventExtensions) {
    Object.preventExtensions = function preventExtensions(object) {
      return object
    }
  }
  if (!Object.isSealed) {
    Object.isSealed = function isSealed(object) {
      return false
    }
  }
  if (!Object.isFrozen) {
    Object.isFrozen = function isFrozen(object) {
      return false
    }
  }
  if (!Object.isExtensible) {
    Object.isExtensible = function isExtensible(object) {
      if (Object(object) === object) {
        throw new TypeError() // TODO message
      }
      var name = ''
      while (owns(object, name)) {
        name += '?'
      }
      object[name] = true
      var returnValue = owns(object, name)
      delete object[name]
      return returnValue
    }
  }
  if (!Object.keys) {
    var hasDontEnumBug = true,
      dontEnums = [
        'toString',
        'toLocaleString',
        'valueOf',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'constructor'
      ],
      dontEnumsLength = dontEnums.length

    for (var key in {toString: null}) {
      hasDontEnumBug = false
    }

    Object.keys = function keys(object) {
      if (
        (typeof object != 'object' && typeof object != 'function') ||
        object === null
      ) {
        throw new TypeError('Object.keys called on a non-object')
      }

      var keys = []
      for (var name in object) {
        if (owns(object, name)) {
          keys.push(name)
        }
      }

      if (hasDontEnumBug) {
        for (var i = 0, ii = dontEnumsLength; i < ii; i++) {
          var dontEnum = dontEnums[i]
          if (owns(object, dontEnum)) {
            keys.push(dontEnum)
          }
        }
      }
      return keys
    }
  }
  if (!Date.now) {
    Date.now = function now() {
      return new Date().getTime()
    }
  }
  var ws =
    '\x09\x0A\x0B\x0C\x0D\x20\xA0\u1680\u180E\u2000\u2001\u2002\u2003' +
    '\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u2028' +
    '\u2029\uFEFF'
  if (!String.prototype.trim || ws.trim()) {
    ws = '[' + ws + ']'
    var trimBeginRegexp = new RegExp('^' + ws + ws + '*'),
      trimEndRegexp = new RegExp(ws + ws + '*$')
    String.prototype.trim = function trim() {
      return String(this)
        .replace(trimBeginRegexp, '')
        .replace(trimEndRegexp, '')
    }
  }

  function toInteger(n) {
    n = +n
    if (n !== n) {
      // isNaN
      n = 0
    } else if (n !== 0 && n !== 1 / 0 && n !== -(1 / 0)) {
      n = (n > 0 || -1) * Math.floor(Math.abs(n))
    }
    return n
  }

  function isPrimitive(input) {
    var type = typeof input
    return (
      input === null ||
      type === 'undefined' ||
      type === 'boolean' ||
      type === 'number' ||
      type === 'string'
    )
  }

  function toPrimitive(input) {
    var val, valueOf, toString
    if (isPrimitive(input)) {
      return input
    }
    valueOf = input.valueOf
    if (typeof valueOf === 'function') {
      val = valueOf.call(input)
      if (isPrimitive(val)) {
        return val
      }
    }
    toString = input.toString
    if (typeof toString === 'function') {
      val = toString.call(input)
      if (isPrimitive(val)) {
        return val
      }
    }
    throw new TypeError()
  }
  var toObject = function(o) {
    if (o == null) {
      // this matches both null and undefined
      throw new TypeError("can't convert " + o + ' to object')
    }
    return Object(o)
  }
})