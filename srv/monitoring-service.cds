using { sap.retrysentinel as my } from '../db/schema';

service MonitoringService @(requires: 'authenticated-user') {
    @readonly
    entity Interfaces     as projection on my.Interfaces;

    @readonly
    entity QueueSnapshots as projection on my.QueueSnapshots;

    @readonly
    entity Alerts         as projection on my.Alerts actions {
        @(restrict: [{ grant: 'acknowledge', to: 'SupportOperator' }])
        action acknowledge(acknowledgedBy: String) returns Alerts;

        @(restrict: [{ grant: 'resolveAlert', to: 'SupportOperator' }])
        action resolveAlert(resolvedBy: String) returns Alerts;

        action explain() returns LargeString;

        action exportIncidentReport(format: String) returns LargeString;
    };

    @readonly
    entity RunbookEntries as projection on my.RunbookEntries;

    @readonly
    entity Systems        as projection on my.Systems;

    @readonly
    entity Connections    as projection on my.Connections;

    // Landscape Topology Graph & Live Health
    @(requires: 'authenticated-user')
    function getTopology() returns LargeString;

    // External telemetry ingestion endpoint
    @(requires: ['SimulatorAdmin', 'SupportOperator'])
    action ingestTelemetry(
        interfaceId             : UUID,
        capturedAt              : Timestamp,
        pendingCount            : Integer,
        failedCount             : Integer,
        retryAttempts           : Integer,
        successCount            : Integer,
        oldestPendingAgeSeconds : Integer
    ) returns String;

    // Simulation trigger endpoint
    @(requires: ['SimulatorAdmin', 'SupportOperator'])
    action triggerSimulation(scenario: String, interfaceId: UUID) returns String;

    // Administrative threshold configuration (Admin only)
    @(requires: 'SimulatorAdmin')
    action configureThresholds(
        interfaceId               : UUID,
        maxRetryThreshold         : Integer,
        queueGrowthLimit          : Integer,
        oldMessageAgeLimitSeconds : Integer,
        recoveryStalledBacklog    : Integer
    ) returns Interfaces;

    // Administrative database reset
    @(requires: 'SimulatorAdmin')
    action resetToCleanSeed() returns String;
}
