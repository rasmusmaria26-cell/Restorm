/**
 * Simulates SAP Cloud Integration (CPI) iFlows pushing live telemetry
 * to Retry Storm Sentinel across one or all monitored integration channels.
 *
 * Usage:
 *   npm run test:cpi             -> Simulates all 3 interfaces simultaneously
 *   node scripts/simulate-cpi.js 1 -> Simulates Order Inbound (Retry Storm)
 *   node scripts/simulate-cpi.js 2 -> Simulates Invoice Outbound (Queue Growth)
 *   node scripts/simulate-cpi.js 3 -> Simulates Inventory Replication (Old Message SLA)
 */

const endpointUrl = 'http://localhost:4004/odata/v4/monitoring/ingestTelemetry';

const INTERFACE_SCENARIOS = [
    {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Order Inbound (S/4HANA)',
        channel: 'Webshop → SAP S/4HANA',
        description: 'Destination S/4HANA returning HTTP 503. Rapid retry cascade triggered.',
        payload: {
            interfaceId: '11111111-1111-1111-1111-111111111111',
            capturedAt: new Date().toISOString(),
            pendingCount: 450,
            failedCount: 190,
            retryAttempts: 320, // Breaches threshold of 30 -> EXCESSIVE_RETRIES (Critical)
            successCount: 4,
            oldestPendingAgeSeconds: 780
        }
    },
    {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Invoice Outbound',
        channel: 'SAP S/4HANA → Payment Gateway',
        description: 'Payment partner throttling connections (HTTP 429). Queue accumulation surging.',
        payload: {
            interfaceId: '22222222-2222-2222-2222-222222222222',
            capturedAt: new Date().toISOString(),
            pendingCount: 320, // Breaches queue limit of 100 -> QUEUE_GROWTH (High)
            failedCount: 12,
            retryAttempts: 8,
            successCount: 85,
            oldestPendingAgeSeconds: 120
        }
    },
    {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Inventory Replication',
        channel: 'Warehouse WMS → BTP Integration',
        description: 'Warehouse batch sync delayed. Oldest message waiting exceeds SLA.',
        payload: {
            interfaceId: '33333333-3333-3333-3333-333333333333',
            capturedAt: new Date().toISOString(),
            pendingCount: 95,
            failedCount: 5,
            retryAttempts: 3,
            successCount: 210,
            oldestPendingAgeSeconds: 960 // Breaches SLA limit of 300s -> OLD_MESSAGE_AGE (High)
        }
    }
];

async function ingestChannel(channelConfig) {
    const auth = 'Basic ' + Buffer.from('bob:').toString('base64');
    const res = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
            'Authorization': auth,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(channelConfig.payload)
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`HTTP ${res.status}: ${err}`);
    }

    const data = await res.json();
    return typeof data.value === 'string' ? JSON.parse(data.value) : data;
}

async function run() {
    const arg = (process.argv[2] || 'all').toLowerCase();

    let targets = [];
    if (arg === '1' || arg.includes('order')) {
        targets = [INTERFACE_SCENARIOS[0]];
    } else if (arg === '2' || arg.includes('invoice')) {
        targets = [INTERFACE_SCENARIOS[1]];
    } else if (arg === '3' || arg.includes('inventory') || arg.includes('wms')) {
        targets = [INTERFACE_SCENARIOS[2]];
    } else {
        targets = INTERFACE_SCENARIOS; // All 3 interfaces
    }

    console.log('\n========================================================================');
    console.log(`🚀 [SAP CPI Multi-Interface Telemetry Simulator] Target: ${targets.length === 1 ? targets[0].name : 'ALL INTERFACES'}`);
    console.log('========================================================================');

    for (const target of targets) {
        console.log(`\n📡 Dispatching from CPI iFlow: [${target.name}]`);
        console.log(`   Route: ${target.channel}`);
        console.log(`   Context: ${target.description}`);
        console.log(`   Metrics: Retries=${target.payload.retryAttempts}, Pending=${target.payload.pendingCount}, Age=${target.payload.oldestPendingAgeSeconds}s`);

        try {
            const result = await ingestChannel(target);
            console.log(`   ✅ Ingestion Status: ${result.status}`);
            console.log(`   🚨 Alert Triggered : ${result.alertTriggered ? 'YES' : 'NO'}`);
            if (result.alertTriggered) {
                console.log(`   ⚠️ Rule Code       : ${result.ruleCode} (${result.severity})`);
                console.log(`   🔄 Incident Repeat : Occurrence #${result.repeatCount}`);
                console.log(`   📋 Summary         : ${result.summary}`);
            }
        } catch (e) {
            console.error(`   ❌ Failed: ${e.message}`);
        }
    }

    console.log('\n========================================================================');
    console.log('👀 [Check Your Dashboard] Open or look at:');
    console.log('   👉 http://localhost:4004/');
    console.log('   Notice how multiple channels have updated their sparklines, topology');
    console.log('   lines, and alert cards independently across the landscape!\n');
}

run();
