const fs = require('fs');
const path = require('path');
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');

describe('SAP Fiori Elements Proof of Concept (Phase 5)', () => {
    let csn;

    before(async () => {
        // Compile CDS model including annotations.cds
        csn = await cds.load(['srv/monitoring-service.cds', 'srv/annotations.cds']);
        assert.ok(csn, 'Compiled CSN model must exist');
    });

    // -------------------------------------------------------------------------
    // 1. CDS UI Vocabulary Annotations Verification
    // -------------------------------------------------------------------------
    describe('CDS UI Vocabularies & Model Annotations', () => {
        it('FIO1: Interfaces entity contains standard @UI.HeaderInfo annotations', () => {
            const ifaceEntity = csn.definitions['MonitoringService.Interfaces'];
            assert.ok(ifaceEntity, 'MonitoringService.Interfaces must be defined in CSN');

            assert.equal(ifaceEntity['@UI.HeaderInfo.TypeName'], 'Monitored Interface');
            assert.equal(ifaceEntity['@UI.HeaderInfo.TypeNamePlural'], 'Monitored Interfaces');
            assert.equal(ifaceEntity['@UI.HeaderInfo.Title.$Type'], 'UI.DataField');
            assert.deepEqual(ifaceEntity['@UI.HeaderInfo.Title.Value'], { '=': 'name' });
        });

        it('FIO2: Interfaces entity contains @UI.SelectionFields filter bar annotations', () => {
            const ifaceEntity = csn.definitions['MonitoringService.Interfaces'];
            const filterFields = ifaceEntity['@UI.SelectionFields'];
            assert.ok(Array.isArray(filterFields), '@UI.SelectionFields must be an array');
            const fieldNames = filterFields.map(f => f['=']);
            assert.ok(fieldNames.includes('name'));
            assert.ok(fieldNames.includes('sourceSystem'));
            assert.ok(fieldNames.includes('targetSystem'));
            assert.ok(fieldNames.includes('active'));
        });

        it('FIO3: Interfaces entity contains @UI.LineItem columns covering monitoring thresholds', () => {
            const ifaceEntity = csn.definitions['MonitoringService.Interfaces'];
            const lineItem = ifaceEntity['@UI.LineItem'];
            assert.ok(Array.isArray(lineItem), '@UI.LineItem must be an array');
            assert.ok(lineItem.length >= 8, `Expected at least 8 table columns, found ${lineItem.length}`);

            const values = lineItem.map(col => col.Value['=']);
            assert.ok(values.includes('name'));
            assert.ok(values.includes('maxRetryThreshold'));
            assert.ok(values.includes('queueGrowthLimit'));
            assert.ok(values.includes('oldMessageAgeLimitSeconds'));
            assert.ok(values.includes('recoveryStalledBacklog'));
        });

        it('FIO4: Interfaces entity contains Object Page @UI.Facets and FieldGroup annotations', () => {
            const ifaceEntity = csn.definitions['MonitoringService.Interfaces'];
            const facets = ifaceEntity['@UI.Facets'];
            assert.ok(Array.isArray(facets), '@UI.Facets must be defined for Object Page');
            assert.ok(facets.length >= 2);

            const thresholdData = ifaceEntity['@UI.FieldGroup#ThresholdDetails.Data'];
            assert.ok(Array.isArray(thresholdData), 'Threshold details FieldGroup must exist');
        });

        it('FIO5: Alerts entity contains @UI.LineItem and @UI.HeaderInfo annotations', () => {
            const alertEntity = csn.definitions['MonitoringService.Alerts'];
            assert.ok(alertEntity, 'MonitoringService.Alerts must exist in CSN');
            assert.equal(alertEntity['@UI.HeaderInfo.TypeName'], 'Incident Alert');

            const lineItem = alertEntity['@UI.LineItem'];
            assert.ok(Array.isArray(lineItem));
            const cols = lineItem.map(c => c.Value['=']);
            assert.ok(cols.includes('ruleCode'));
            assert.ok(cols.includes('severity'));
            assert.ok(cols.includes('status'));
        });
    });

    // -------------------------------------------------------------------------
    // 2. Fiori Elements Application Manifest & Webapp Artifacts
    // -------------------------------------------------------------------------
    describe('Fiori Elements Application Descriptor & Manifest Schema', () => {
        const manifestPath = path.resolve(__dirname, '../app/fiori/webapp/manifest.json');
        const indexPath = path.resolve(__dirname, '../app/fiori/webapp/index.html');
        const componentPath = path.resolve(__dirname, '../app/fiori/webapp/Component.js');

        it('MAN1: manifest.json exists and defines standard sap.app and OData V4 dataSource', () => {
            assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

            assert.equal(manifest['sap.app']?.id, 'sap.retrysentinel.interfaces');
            assert.equal(manifest['sap.app']?.type, 'application');

            const mainService = manifest['sap.app']?.dataSources?.mainService;
            assert.ok(mainService, 'mainService dataSource must be defined');
            assert.equal(mainService.uri, '/odata/v4/monitoring/');
            assert.equal(mainService.type, 'OData');
            assert.equal(mainService.settings?.odataVersion, '4.0');
        });

        it('MAN2: manifest.json configures Fiori Elements List Report and Object Page routing', () => {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const targets = manifest['sap.ui5']?.routing?.targets;
            assert.ok(targets, 'Routing targets must be defined');

            const listReport = targets.InterfacesListReport;
            assert.ok(listReport);
            assert.equal(listReport.name, 'sap.fe.templates.ListReport');
            assert.equal(listReport.options?.settings?.entitySet, 'Interfaces');

            const objectPage = targets.InterfacesObjectPage;
            assert.ok(objectPage);
            assert.equal(objectPage.name, 'sap.fe.templates.ObjectPage');
            assert.equal(objectPage.options?.settings?.entitySet, 'Interfaces');
        });

        it('MAN3: Component.js and index.html bootstrap files are present and valid', () => {
            assert.ok(fs.existsSync(componentPath), 'Component.js must exist');
            const compContent = fs.readFileSync(componentPath, 'utf8');
            assert.ok(compContent.includes('sap/fe/core/AppComponent'));

            assert.ok(fs.existsSync(indexPath), 'index.html must exist');
            const indexContent = fs.readFileSync(indexPath, 'utf8');
            assert.ok(indexContent.includes('sap-ui-bootstrap') || indexContent.includes('sap.retrysentinel.interfaces'));
            assert.ok(indexContent.includes('/odata/v4/monitoring/'));
        });
    });

    // -------------------------------------------------------------------------
    // 3. Non-Destructive Coexistence
    // -------------------------------------------------------------------------
    describe('Non-Destructive Coexistence with Custom Dashboard', () => {
        it('COEX1: Custom HTML5 Operations Dashboard remains fully operational at root', () => {
            const customIndexPath = path.resolve(__dirname, '../app/index.html');
            const customAppPath = path.resolve(__dirname, '../app/app.js');

            assert.ok(fs.existsSync(customIndexPath), 'app/index.html must exist');
            assert.ok(fs.existsSync(customAppPath), 'app/app.js must exist');

            const customIndex = fs.readFileSync(customIndexPath, 'utf8');
            assert.ok(customIndex.includes('id="login-screen"'));
            assert.ok(customIndex.includes('id="main-app"'));
            assert.ok(customIndex.includes('/fiori/webapp/index.html'), 'Custom dashboard must link to Fiori Elements view');
        });
    });
});

