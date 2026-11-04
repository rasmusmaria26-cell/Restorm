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

    // Simulation trigger endpoint (one-shot, immediate)
    @(requires: ['SimulatorAdmin', 'SupportOperator'])
    action triggerSimulation(scenario: String, interfaceId: UUID) returns String;

    // Gradual simulation session structure
    type SimulationSessionInfo {
        sessionId       : String;
        scenario        : String;
        interfaceId     : String;
        status          : String; // RUNNING, COMPLETED, FAILED, CANCELLED
        currentStage    : Integer;
        totalStages     : Integer;
        stageName       : String;
        progressPercent : Integer;
        startedAt       : String;
        completedAt     : String;
        error           : String;
        message         : String;
    };

    // Action: Start gradual multi-stage simulation in background
    @(requires: ['SimulatorAdmin', 'SupportOperator'])
    action startGradualSimulation(
        scenario       : String,
        interfaceId    : String,
        stepIntervalMs : Integer
    ) returns SimulationSessionInfo;

    // Function: Poll simulation session status
    @(requires: 'authenticated-user')
    function getSimulationStatus(
        sessionId   : String,
        interfaceId : String
    ) returns SimulationSessionInfo;

    // Action: Cancel an active simulation
    @(requires: ['SimulatorAdmin', 'SupportOperator'])
    action cancelSimulation(
        sessionId : String
    ) returns SimulationSessionInfo;

    // Phase 3: Proactive Predictive Forecast Structure
    type PredictionForecast {
        interfaceId              : UUID;
        interfaceName            : String;
        metric                   : String;
        metricLabel              : String;
        ruleCode                 : String;
        currentValue             : Integer;
        threshold                : Integer;
        growthRatePerSecond      : Decimal(9, 2);
        confidence               : Decimal(5, 2);
        rSquared                 : Decimal(5, 4);
        estimatedSecondsToBreach : Decimal(9, 1);
        projectedBreachAt        : String;
        status                   : String;
        riskLevel                : String;
        observationsCount        : Integer;
        hasPrediction            : Boolean;
        summary                  : String;
    };

    // Phase 3: Query proactive predictions for an interface
    @(requires: 'authenticated-user')
    function getPredictions(interfaceId : UUID) returns array of PredictionForecast;

    // Phase 3: Query proactive predictions landscape-wide
    @(requires: 'authenticated-user')
    function getLandscapePredictions() returns array of PredictionForecast;

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

    // Get authenticated user identity and roles from CAP context
    @(requires: 'authenticated-user')
    action getCurrentUser() returns UserInfo;

    entity UserInfo {
        key userId : String;
        roles : Array of String;
    };
}
