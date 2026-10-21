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

        action explain() returns LargeString;
    };

    @readonly
    entity RunbookEntries as projection on my.RunbookEntries;

    // Simulation trigger endpoint
    @(requires: ['SimulatorAdmin', 'SupportOperator'])
    action triggerSimulation(scenario: String, interfaceId: UUID) returns String;
}
