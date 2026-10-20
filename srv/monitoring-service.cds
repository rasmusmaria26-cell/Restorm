using { sap.retrysentinel as my } from '../db/schema';

service MonitoringService {
    entity Interfaces     as projection on my.Interfaces;
    entity QueueSnapshots as projection on my.QueueSnapshots;
    entity Alerts         as projection on my.Alerts actions {
        action acknowledge(acknowledgedBy: String) returns Alerts;
        action explain() returns LargeString;
    };
    entity RunbookEntries as projection on my.RunbookEntries;

    // Simulation trigger endpoint
    action triggerSimulation(scenario: String, interfaceId: UUID) returns String;
}
