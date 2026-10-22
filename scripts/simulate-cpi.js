/**
 * Simulates an SAP Cloud Integration (CPI) iFlow pushing live telemetry
 * to Retry Storm Sentinel via the Groovy connector pattern.
 */

const targetInterfaceId = '11111111-1111-1111-1111-111111111111'; // Order Inbound (S/4HANA)
const endpointUrl = 'http://localhost:4004/odata/v4/monitoring/ingestTelemetry';

const cpiPayload = {
    interfaceId: targetInterfaceId,
    capturedAt: new Date().toISOString(),
    pendingCount: 450,
    failedCount: 190,
    retryAttempts: 320, // Breaches threshold -> triggers EXCESSIVE_RETRIES
    successCount: 4,
    oldestPendingAgeSeconds: 780
};

async function run() {
    console.log('\n🚀 [SAP CPI Simulator] Dispatching telemetry from Exception Subprocess...');
    console.log('📍 Interface:', 'Order Inbound (S/4HANA) (' + targetInterfaceId + ')');
    console.log('📊 Telemetry Metrics:');
    console.log('   - Retry Attempts : ' + cpiPayload.retryAttempts + ' (Critical limit is 30)');
    console.log('   - Pending Backlog: ' + cpiPayload.pendingCount);
    console.log('   - Failed Count   : ' + cpiPayload.failedCount);
    console.log('   - Oldest Age     : ' + cpiPayload.oldestPendingAgeSeconds + ' seconds');

    try {
        const auth = 'Basic ' + Buffer.from('bob:').toString('base64');
        const res = await fetch(endpointUrl, {
            method: 'POST',
            headers: {
                'Authorization': auth,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(cpiPayload)
        });

        if (!res.ok) {
            const err = await res.text();
            console.error('\n❌ Ingestion Failed (HTTP ' + res.status + '):', err);
            return;
        }

        const data = await res.json();
        const result = typeof data.value === 'string' ? JSON.parse(data.value) : data;

        console.log('\n✅ [Sentinel Response]');
        console.log('   - Ingestion Status:', result.status);
        console.log('   - Alert Triggered :', result.alertTriggered ? '🚨 YES' : 'NO');
        console.log('   - Alert Rule      :', result.ruleCode);
        console.log('   - Severity        :', result.severity);
        console.log('   - Occurrence Count:', result.repeatCount);
        console.log('   - Summary         :', result.summary);

        console.log('\n👀 [Next Step] Open or switch to your browser at:');
        console.log('   👉 http://localhost:4004/');
        console.log('   Notice that the interface turned RED and the alert card appeared.');
        console.log('   Click "Explain" on the alert card to see Google Gemini diagnose this CPI incident!\n');

    } catch (e) {
        console.error('\n❌ Could not connect to Sentinel. Is "npm start" running on port 4004?');
        console.error('   Details:', e.message);
    }
}

run();
