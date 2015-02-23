var Enti = require('enti'),
    EventEmitter = require('events').EventEmitter,
    watchFilter = require('./filter'),
    is = require('./is'),
    same = require('same-value');

function fuseBinding(){
    var bindings = Array.prototype.slice.call(arguments),
        transform = bindings.pop(),
        updateTransform,
        resultBinding = createBinding('result'),
        selfChanging;

    if(typeof bindings[bindings.length-1] === 'function' && !is.binding(bindings[bindings.length-1])){
        updateTransform = transform;
        transform = bindings.pop();
    }

    resultBinding.model.set = function(key, value){
        if(updateTransform){
            selfChanging = true;
            var newValue = updateTransform(value);
            if(!same(newValue, bindings[0]())){
                bindings[0](newValue);
                resultBinding._change(newValue);
            }
            selfChanging = false;
        }else{
            this.emit(key, value);
        }
    };

    function change(){
        if(selfChanging){
            return;
        }
        resultBinding(transform.apply(null, bindings.map(function(binding){
            return binding();
        })));
    }

    bindings.forEach(function(binding, index){
        if(typeof binding === 'string'){
            binding = createBinding(binding);
            bindings.splice(index,1,binding);
        }
        binding.on('change', change);
        resultBinding.on('detach', binding.detach);
    });

    resultBinding.on('attach', function(object){
        selfChanging = true;
        bindings.forEach(function(binding){
            binding.attach(object, true);
        });
        selfChanging = false;
        change();
    });

    return resultBinding;
}

function drill(sourceKey, targetKey){
    var bindings = Array.prototype.slice.call(arguments),
        resultBinding = createBinding('result'),
        sourceBinding = createBinding(sourceKey),
        targetBinding = createBinding(targetKey);

    resultBinding._fastn_binding = sourceKey + '.' + targetKey;

    var remove,
        lastTarget,
        outChange;

    resultBinding.on('attach', sourceBinding.attach);

    sourceBinding.on('change', function(object){
        var newTarget = sourceBinding();
        if(!same(lastTarget, newTarget)){
            lastTarget = newTarget;
            targetBinding.attach(newTarget);
        }
    });

    resultBinding._set = function(val){
        targetBinding(val);
    };

    resultBinding.model.get = function(){
        return targetBinding();
    };

    targetBinding.on('change', resultBinding._change);

    resultBinding.on('detach', function(){
        sourceBinding.detach();
        targetBinding.detach();
    });

    resultBinding.on('destroy', function(){
        sourceBinding.destroy();
        targetBinding.destroy();
    });

    return resultBinding;
}

function createBinding(keyAndFilter){
    var args = Array.prototype.slice.call(arguments);

    if(args.length > 1){
        return fuseBinding.apply(null, args);
    }

    keyAndFilter = keyAndFilter.toString();

    var keyAndFilterParts = keyAndFilter.split('|'),
        filter = keyAndFilterParts[1],
        key = keyAndFilterParts[0];

    var dotIndex = key.indexOf('.');

    if(key.length > 1 && ~dotIndex){
        return drill(key.slice(0, dotIndex), keyAndFilter.slice(dotIndex+1));
    }

    var value,
        binding = function binding(newValue){
        if(!arguments.length){
            return value;
        }

        if(key === '.'){
            return;
        }

        binding._set(newValue);
    };
    for(var emitterKey in EventEmitter.prototype){
        binding[emitterKey] = EventEmitter.prototype[emitterKey];
    }
    binding.setMaxListeners(1000);
    binding.model = new Enti(),
    binding._fastn_binding = key;
    binding._loose = true;
    binding.model._events = {};
    binding.model._events[key] = function(value){
        binding._change(value);
    };

    binding.attach = function(object, loose){

        // If the binding is being asked to attach loosly to an object,
        // but it has already been defined as being firmly attached, do not attach.
        if(loose && !binding._loose){
            return binding;
        }

        binding._loose = loose;

        if(object instanceof Enti){
            object = object._model;
        }

        if(!(object instanceof Object)){
            object = {};
        }

        binding.model.attach(object);
        binding._scope = object;
        binding._change(binding.model.get(key), false);
        binding.emit('attach', object, true);
        binding.emit('change', value);
        return binding;
    };
    binding.detach = function(loose){
        if(loose && !binding._loose){
            return binding;
        }

        value = undefined;
        binding.model.detach();
        binding._scope = null;
        binding.emit('detach', true);
        return binding;
    };
    binding.drill = function(drillKey){
        return drill(key, drillKey);
    };
    binding._set = function(newValue){
        binding.model.set(key, newValue);
    };
    binding._change = function(newValue, emit){
        value = newValue;
        if(emit !== false){
            binding.emit('change', value);
        }
    };
    binding.clone = function(){
        return createBinding.apply(null, args);
    };
    binding.destroy = function(){
        this.detach();
    };

    filter && watchFilter(binding, filter);

    return binding;
}

module.exports = createBinding;