// Predefine sap/insights/channels/ContextChannel to eliminate "S/CUBE is not yet supported"
// console warning in standalone Fiori Elements runtime (outside Fiori Launchpad).
if (typeof sap !== 'undefined' && sap.ui && typeof sap.ui.predefine === 'function') {
    sap.ui.predefine('sap/insights/channels/ContextChannel', [], function () {
        'use strict';

        var dummyChannel = {
            registerProvider: function () {},
            unregisterProvider: function () {},
            broadcast: function () {},
            subscribe: function () {}
        };

        var ContextChannel = {
            getInstance: function () {
                return Promise.resolve(dummyChannel);
            }
        };

        ContextChannel.default = ContextChannel;
        return ContextChannel;
    });
}

sap.ui.define(['sap/fe/core/AppComponent'], function (AppComponent) {
    'use strict';

    return AppComponent.extend('sap.retrysentinel.interfaces.Component', {
        metadata: {
            manifest: 'json'
        }
    });
});

