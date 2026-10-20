RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

# **RETRY STORM SENTINEL** 

## **Master Project Document** 

_SAP BTP • Business Application Studio • CAP • OData • Generative AI_ 

Prepared for: Maria Rasmus R 

Gen AI Developer Intern, IT Resonance 

Version 1.0 | 20 October 2026 

Purpose: a practical, beginner-friendly blueprint for building an integration retry monitoring prototype. 

Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

### **Document control** 

|**Item**|**Details**|
|---|---|
|Project name|Retry Storm Sentinel|
|Document type|Master project specification and implementation guide|
|Status|Draft / learning project|
|Primary environment|SAP Business Application Studio (BAS), or local<br>development while learning|
|Backend|SAP Cloud Application Programming Model (CAP),<br>Node.js|
|Data model|CDS|
|API layer|OData V4|
|Initial database|SQLite for local development|
||Fiori elements if the selected CAP template and|
|UI|environment support it; a simpler UI may be used for<br>the first demo|
|AI|Optional later milestone; model/provider depends on<br>access and credentials|
|Production status|Not production-ready; prototype with simulated data|



### **How to use this document** 

- Treat this document as the main reference for the project scope, architecture, data model, tests and milestones. 

- Build one milestone at a time. Do not ask an AI coding tool to generate the entire application in one operation. 

- Run the app and test each milestone before moving forward. 

- Use AI to explain and review code, but verify every change in your own environment. 

- Keep secrets, access tokens and API keys out of source control. 

### **1. Executive summary** 

Retry Storm Sentinel is a small monitoring application that detects when an integration repeatedly fails and retries messages in a way that creates a growing backlog. The first version uses simulated message and queue data instead of connecting to a live SAP system. Rule-based logic identifies risky patterns. A dashboard presents alerts, and an optional Generative AI layer explains the evidence and recommends safe investigation steps from a curated runbook. 

#### **One-line summary** 

Detect repeated integration failures and dangerous queue growth early, then help an operator understand what to check first. 

#### **Core design principle** 

Rules detect the pattern; AI explains the evidence. AI does not make the detection decision and does not perform automatic remediation. 

Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

### **2. Problem statement** 

Enterprise applications often exchange messages through integrations. If a receiving system is unavailable, messages may fail and be retried. Retries are useful when failures are temporary, but excessive retries combined with continuing incoming traffic can increase queue size, delay processing and make recovery harder. 

#### **Example** 

1. An online shop sends orders to a receiving system. 

2. The receiving system becomes temporarily unreachable. 

3. Messages fail and are scheduled for retry. 

4. New messages continue arriving while old messages remain pending. 

5. The pending queue grows and processing delays increase. 

6. Support staff need to understand whether the issue is connectivity, destination availability, invalid data, retry configuration or another cause. 

#### **Problem this prototype addresses** 

- Repeated failures or retries are unusually high. 

- The pending queue grows rapidly or stays high for too long. 

- The oldest pending message becomes increasingly old. 

- A system recovers, but the queue does not drain as expected. 

- Operators need a clear alert with supporting facts and safe next checks. 

#### **What this project does not claim** 

- It does not prove a real SAP integration is failing; version 1 uses simulated data. 

- It does not replace SAP monitoring, SAP Integration Suite monitoring, enterprise observability tools or production incident management. 

- It does not automatically restart integrations, delete messages, change retry policies or repair data. 

- It does not identify a definitive root cause from queue metrics alone. 

### **3. Goals and non-goals** 

#### **Goals** 

- Create a working CAP application and understand its folder structure. 

- Model integrations, message activity, queue snapshots, alerts and runbook entries using CDS. 

- Expose application data through OData V4. 

- Generate realistic simulated data for normal behaviour, failures, retry loops and recovery. 

- Detect retry storms with explainable deterministic rules. 

- Display interfaces and alerts in a usable UI. 

- Allow an operator to acknowledge an alert and record its status. 

- Add optional AI explanations grounded in the alert facts and runbook. 

- Create repeatable tests and a README so another developer can run the prototype. 

#### **Non-goals for the MVP** 

- Live connectivity to SAP systems or real messaging infrastructure. 

- Production-grade authentication, authorisation, high availability or deployment. 

- Automatic remediation or autonomous agent actions. 

- Complex machine-learning models or vector search. 

- Email, Teams or other notifications unless core functionality is complete. 

Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

- HANA Cloud as a requirement; use SQLite locally first. 

### **4. Users and use cases** 

|**User**|**Need**|**How the prototype helps**|
|---|---|---|
|Integration support engineer|Find dangerous retry behaviour<br>quickly|Shows queue growth, retry counts<br>and alert evidence|
|Operations analyst|Understand the impact and what to<br>check|Provides a plain-English summary<br>and runbook steps|
|Developer|Reproduce and investigate an issue|Offers deterministic demo<br>scenarios and stored sample data|
|Reviewer or interviewer|See a clear end-to-end engineering<br>project|Provides architecture, tests, demo<br>scenarios and documentation|



#### **Primary user journey** 

7. The simulator creates message events and queue snapshots. 

8. The backend calculates monitoring metrics for each interface. 

9. The detection service evaluates rules. 

10. An alert is stored when a rule is triggered. 

11. The UI displays the alert and the evidence behind it. 

12. The operator opens the alert, reviews details and acknowledges it. 

13. Optionally, the operator requests an AI explanation based on approved runbook entries. 

### **5. Key concepts in simple language** 

|**Term**|**Simple meaning in this project**|
|---|---|
|Interface / integration|A connection or process that transfers data between<br>systems.|
|Message|One unit of data being transferred, such as an order.|
|Retry|Another attempt to process a message after an earlier<br>attempt failed.|
|Queue|A holding area for messages waiting to be processed.|
|Backlog|Messages that are still waiting or have not completed.|
|Retry storm|A risky pattern where repeated failures and retries<br>contribute to excessive load or a growing backlog.|
|CAP|SAP's application framework for building services and<br>business applications.|
|CDS|The modelling language used to define entities and<br>relationships.|
|OData|A standard way for clients to read and operate on<br>exposed business data.|
|Fiori elements|SAP UI technology that can generate business screens<br>from service metadata and annotations.|
|Runbook|A short, reviewed guide describing investigation steps|



Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

for known symptoms. 

Grounded AI 

AI that is given relevant evidence and reference material instead of being asked to guess. 

### **6. Scope and feature priorities** 

|**Priority**|**Feature**|**Acceptance target**|
|---|---|---|
|P0 – required|CAP project starts|Developer can start it and access<br>the service root or landing page.|
|P0 – required|Data model and OData service|Interfaces, metrics and alerts can<br>be queried.|
|P0 – required|Simulator|Repeatable normal, retry storm and<br>recovery data can be generated.|
|P0 – required|Detection rules|Rules produce expected results for<br>scripted scenarios.|
|P0 – required|Alert list and details|User can see why an alert fired.|
|P0 – required|Acknowledgement|Alert status changes and persists.|
|P1 – recommended|AI explanation|Explanation uses supplied metrics<br>and cites runbook IDs.|
|P1 – recommended|Tests and README|Another developer can reproduce<br>the demo.|
|P2 – optional|Trend charts|Queue size and retry metrics can be<br>visualised over time.|
|P2 – optional|CSV upload|Anonymised aggregate data can be<br>imported after validation.|
|P2 – optional|Notifications|Send an alert through a permitted<br>provider.|
|P2 – optional|HANA Cloud deployment|Only after local functionality is<br>stable and access is confirmed.|



### **7. Proposed architecture** 

Simulated message generator | v CAP application (Node.js) |-- Data model (CDS) |-- OData V4 service |-- Metrics and detection logic 

- |-- Alert lifecycle / acknowledgement 

|-- Optional AI explanation action | +--> SQLite database (local MVP) 

Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

| +--> Fiori elements or simple UI | +--> Optional LLM provider ^ alert facts + selected runbook entries 

The initial application can run locally during development. BAS is the cloud development environment, not the monitoring engine itself. A live SAP integration is intentionally excluded from version 1. 

#### **Component responsibilities** 

|**Component**|**Responsibility**|
|---|---|
|Simulator|Produces repeatable message attempts, failures,<br>queue sizes and recovery patterns.|
|CDS model|Defines the structure of interfaces, snapshots, alerts<br>and runbook records.|
|CAP service|Exposes OData and provides business actions.|
|Detection module|Evaluates metrics and creates alerts based on explicit<br>rules.|
|Database|Stores demo data and alert state.|
|UI|Shows current metrics, alert details and operator<br>actions.|
|AI explanation module|Summarises observed facts and retrieves safe next<br>checks from the runbook.|



### **8. Technology stack and environment** 

|**Technology**|**Use**|**Required for MVP?**|
|---|---|---|
|SAP Business Application Studio|Cloud development environment|Preferred for SAP learning; local<br>Node.js is also usable|
|Node.js|Runtime for CAP application|Yes|
|SAP CAP / @sap/cds|Service and business application<br>framework|Yes|
|CDS|Entity and service modelling|Yes|
|OData V4|API protocol|Yes|
|SQLite / @cap-js/sqlite|Local database|Recommended|
|Fiori elements|SAP-style UI|Recommended after backend<br>works|
|Git and GitHub|Version control and sharing<br>between IDEs|Strongly recommended|
|LLM provider|Generate explanations|Optional for MVP|
|SAP HANA Cloud|Cloud database|No|



Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

Check versions in the actual environment before installing packages. Do not assume a BTP Trial account includes every service. Prefer the supported CAP project template or current SAP tutorial when starting a new project. Keep package.json and package-lock.json consistent; package-lock.json should normally be maintained by npm. 

### **9. Data model** 

Start with a small model. Avoid storing every possible technical detail before the basic flow works. A practical MVP can use Interface, QueueSnapshot, RetryMetric or MessageEvent, Alert and RunbookEntry. If storing individual events is too much for the first milestone, begin with aggregate snapshots and add message-level events later. 

#### **9.1 Interface** 

|**Field**|**Purpose**|
|---|---|
|ID|Stable unique identifier.|
|name|Human-readable integration name, e.g. Order Inbound.|
|sourceSystem|System sending data.|
|targetSystem|System receiving data.|
|active|Whether the interface is expected to operate.|
|expectedSchedule|Optional simple schedule or active-hours<br>configuration.|
|description|Purpose of the integration.|



#### **9.2 QueueSnapshot** 

|**Field**|**Purpose**|
|---|---|
|ID|Unique snapshot identifier.|
|interface|Reference to the interface.|
|capturedAt|Timestamp of the snapshot.|
|pendingCount|Number of messages waiting.|
|failedCount|Failed messages in the chosen interval or current view;<br>define semantics clearly.|
|retryAttempts|Retry attempts during the chosen interval.|
|successCount|Successfully processed messages during the interval.|
|oldestPendingAgeSeconds|Age of the oldest pending message, when available.|



#### **9.3 Alert** 

|**Field**|**Purpose**|
|---|---|
|ID|Unique alert identifier.|
|interface|Interface associated with the alert.|
|ruleCode|Rule that triggered the alert.|
|severity|Information, Warning, High or Critical; use a<br>documented mapping.|
|status|Open, Acknowledged, Resolved or Closed, as defined|



Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

||by the app.|
|---|---|
|detectedAt|When the application detected the pattern.|
|windowStart / windowEnd|Time interval analysed.|
|observedMetrics|Expected and actual values used by the rule; use<br>explicit fields or structured data.|
|summary|Short deterministic explanation of the rule result.|
|acknowledgedAt / acknowledgedBy|Optional audit information for acknowledgement.|
|aiExplanation|Optional saved explanation; do not treat it as<br>authoritative truth.|



#### **9.4 RunbookEntry** 

|**Field**|**Purpose**|
|---|---|
|ID|Stable runbook entry ID.|
|title|Short label, e.g. Destination unavailable.|
|symptoms|Symptoms this entry may explain.|
|checks|Safe investigation steps.|
|limitations|What this entry does not prove.|
|keywords|Simple matching terms for the initial version.|



#### **Relationships** 

- One Interface can have many QueueSnapshots. 

- One Interface can have many Alerts over time. 

- An Alert can reference one or more relevant RunbookEntries through a matching result or association. 

- If individual MessageEvents are added later, each event belongs to an Interface and can include correlation ID, timestamp, outcome and attempt number. 

Data modelling note: choose clear semantics for counters. For example, decide whether failedCount is a count of distinct failed messages, failed attempts, or currently failed messages. Do not mix these meanings. 

### **10. Detection logic** 

Start with deterministic rules that can be tested. The goal is to detect a suspicious pattern and provide evidence, not to claim a definitive root cause. 

#### **Rule A — Excessive retries** 

- Calculate retry attempts during a defined time window. 

- Compare the value to a configurable threshold or a baseline for that interface. 

- Trigger only if the threshold is exceeded and the sample/window is meaningful. 

- Record the observed count, threshold, window and rule version in the alert. 

#### **Rule B — Queue growth** 

- Compare queue size in the current snapshot with earlier snapshots. 

- Calculate absolute growth and percentage growth when the starting value is non-zero. 

- Flag rapid growth across multiple snapshots or a queue that exceeds a configured limit. 

Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

- Avoid percentage-only rules when the queue starts at zero; use an absolute increase too. 

#### **Rule C — Persistent backlog / oldest message age** 

- Flag when the oldest pending message exceeds a configured age. 

- Optionally require that the queue is also above a minimum size. 

- Use this as an indication that processing may be stuck, not proof of why. 

#### **Rule D — Recovery not progressing** 

- After a simulated destination recovery, watch whether pendingCount starts to decrease. 

- If it remains high or continues to grow after a grace period, create a recovery warning. 

- Use a scripted recovery scenario so the behaviour is repeatable in tests. 

#### **Threshold configuration** 

- Put thresholds in one configuration module or clearly named constants. 

- Document units and window sizes. 

- Begin with simple thresholds, then tune them using generated normal and failure scenarios. 

- Do not present thresholds as universally correct; they are prototype defaults. 

- Add a cooldown or deduplication rule so the app does not create a new alert every polling cycle for the same ongoing incident. 

#### **Example pseudocode** 

for each interface: 

metrics = calculate_metrics(interface, time_window) 

if metrics.retry_attempts > RETRY_LIMIT: create_or_update_alert("EXCESSIVE_RETRIES", metrics) 

if metrics.pending_growth >= MIN_QUEUE_GROWTH: create_or_update_alert("QUEUE_GROWTH", metrics) 

if metrics.oldest_pending_age > MAX_PENDING_AGE: create_or_update_alert("OLD_MESSAGE_AGE", metrics) 

if interface_is_in_recovery_window(interface): if queue_is_not_draining(metrics): create_or_update_alert("RECOVERY_STALLED", metrics) 

### **11. Simulator design** 

The simulator makes it possible to develop and demo the project without connecting to a real integration platform. It should generate repeatable scenarios, not random data only. 

|**Scenario**|**Generated behaviour**|**Expected result**|
|---|---|---|
|Normal traffic|Messages succeed; queue stays<br>low or drains.|No alert.|
|Destination outage|Failures and retries rise; queue<br>grows.|Retry and/or queue alert.|
|Retry storm|Repeated attempts continue while|High-severity alert after threshold is|



Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

||incoming messages arrive.|crossed.|
|---|---|---|
|Recovery|Destination becomes available;<br>successes rise and queue declines.|Alert remains visible; recovery state<br>can be shown.|
|Stuck backlog|Retries reduce but pending count<br>and oldest age remain high.|Backlog or stalled-recovery alert.|
|Small transient spike|A brief retry increase returns to<br>normal quickly.|No critical alert, or a lower-severity<br>warning depending on policy.|



#### **Simulator requirements** 

- Use a fixed random seed or named scenarios so tests are repeatable. 

- Make each scenario selectable or runnable from a command/script. 

- Record timestamps consistently and define the time zone used in display. 

- Generate normal background traffic before injecting an incident. 

- Include recovery data, not only failure data. 

- Provide a reset or clean-seed method for demos. 

### **12. UI design** 

The first UI should be functional and easy to explain. Visual polish comes after correct detection. 

#### **Recommended screens** 

|**Screen**|**Contents**|
|---|---|
|Overview|Active interfaces, open alerts, queue totals and recent<br>incidents.|
|Interfaces|Interface name, source/target, latest queue size, retry<br>rate and status.|
|Interface details|Queue trend, retry attempts, successful messages and<br>latest snapshots.|
|Alerts|Rule, severity, interface, detected time, status and<br>acknowledgement action.|
|Alert details|Evidence, time window, metrics, deterministic<br>explanation and runbook checks.|
|AI explanation panel (optional)|Summary, likely possibilities, cited runbook IDs,<br>limitations and suggested checks.|



Use a CAP/Fiori elements template where practical. If UI setup becomes a blocker, complete the service and detection rules first and use a simple temporary interface or API testing tool until the backend is stable. 

### **13. OData service and operations** 

Expose the core entities through a CAP service. Exact URLs depend on the service name and project configuration; confirm them from the running CAP service index instead of guessing. 

|**Operation**|**Purpose**|
|---|---|
|GET interfaces|List the configured integrations.|



Learning prototype • Simulated data • Not production monitoring 

||RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT|
|---|---|
|GET queue snapshots|Inspect recent queue and retry metrics.|
|GET alerts|List alerts and filter by status, severity or interface<br>when supported.|
|GET alert details|Read evidence for a specific alert.|
|POST / action: acknowledge|Mark an alert as acknowledged after validating the<br>current state.|
|POST / action: explain (optional)|Create an AI explanation using alert facts and runbook<br>material.|



Use OData query options supported by the generated service, such as $filter, $select and $top, when testing. Do not assume every custom operation has the same URL pattern; check the service metadata and CAP output. 

### **14. Generative AI design** 

AI is a later milestone. The application must detect retry patterns and display alerts without any model call. AI receives structured evidence and selected runbook entries, then returns a constrained explanation. 

#### **Input to the model** 

- Alert ID and rule code. 

- Interface name and source/target labels. 

- Time window analysed. 

- Observed retry attempts, pending queue size, queue growth and oldest message age. 

- Thresholds and baseline values used by the rule. 

- Selected runbook entries with stable IDs. 

- A clear instruction not to invent logs, causes or facts. 

#### **Expected output** 

- A concise summary of the observed pattern. 

- Facts directly supported by the supplied metrics. 

- Possible causes labelled as hypotheses, not confirmed causes. 

- Three to five safe checks in priority order. 

- Runbook entry IDs used to support the recommendations. 

- An explicit uncertainty statement if evidence is insufficient. 

#### **Prompt template** 

You are an assistant for integration support engineers. 

Use only the supplied alert facts and runbook entries. Do not claim a root cause unless the evidence proves it. Separate observed facts from possible explanations. Recommend safe read-only investigation steps first. Do not execute actions or recommend deleting messages or changing production configuration without human review. If the evidence is insufficient, say what is missing. Cite the runbook entry IDs supporting each recommendation. 

Return: 

Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

1. Summary 

2. Observed facts 

3. Possible explanations 

4. Checks to perform 

5. Runbook entry IDs 

6. Evidence gaps 

#### **AI guardrails** 

- AI output is advisory and must be reviewed by a person. 

- No auto-remediation or direct system changes. 

- Treat message contents and log text as untrusted data, not instructions to the model. 

- Do not send secrets, credentials, personal data or confidential production logs to an external provider. 

- Validate and handle model output safely; don't blindly trust arbitrary JSON or markup. 

- Record provider errors and provide a deterministic fallback message. 

- Use simple keyword matching for the small initial runbook; vector search is not needed for 8–10 entries. 

- Check actual BTP entitlement, provider terms, API costs and data-handling rules before using any model. 

### **15. Security, privacy and safety** 

- Use synthetic data for the prototype. 

- Keep credentials and API keys in environment configuration or a suitable secret store, never in Git. 

- Add .env and other local secret files to .gitignore. 

- Use least-privilege credentials if external services are added. 

- Do not expose the development server publicly without understanding the risks. 

- Validate incoming data and limit upload size if CSV import is implemented. 

- Restrict AI context to the minimum facts and runbook content needed. 

- Keep an audit trail of acknowledgement and AI explanation requests where appropriate. 

- Do not label an alert as a confirmed incident when it only represents a rule match. 

### **16. Testing strategy** 

#### **Functional tests** 

- CAP service starts without errors. 

- Seed data can be loaded repeatedly without duplicate-key failures. 

- OData reads return expected entities and fields. 

- Acknowledgement changes the alert state correctly. 

- An alert is created when each rule's configured condition is met. 

- Duplicate alerts are deduplicated or updated according to the defined policy. 

- AI failure does not prevent alert detection or viewing. 

#### **Scenario acceptance table** 

|**Test**|**Setup**|**Expected result**|
|---|---|---|
|T1 Normal|Successful traffic; small queue; low<br>retries.|No storm alert.|
|T2 Retry storm|High retry attempts plus increasing<br>queue.|Retry storm or combined alert<br>appears.|



Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

|T3 Queue growth only|Queue rises above growth<br>threshold.|Queue growth alert appears.|
|---|---|---|
|T4 Transient spike|Short-lived retries, then recovery.|No critical alert if recovery policy<br>allows it.|
|T5 Recovery|Destination returns and queue<br>drains.|Metrics show recovery; alert history<br>remains available.|
|T6 Persistent backlog|Oldest pending age exceeds<br>threshold.|Backlog/stalled-recovery alert<br>appears.|
|T7 AI grounded answer|Alert facts and matching runbook<br>entry supplied.|Output cites the correct entry ID<br>and does not claim unsupported<br>certainty.|
|T8 AI unavailable|Model provider returns an error or is<br>not configured.|Core monitoring continues and a<br>clear fallback is shown.|



#### **Quality metrics** 

- Detection rate on the known injected scenarios. 

- False-positive count on normal and transient traffic scenarios. 

- Time between the injected incident and alert creation. 

- Duplicate alert count during a single ongoing incident. 

- Percentage of AI test responses citing the correct runbook entry. 

For a small demo, report results on the scripted test set. Do not describe them as production accuracy. 

### **17. Repository structure** 

retry-storm-sentinel/ ├── app/                    # UI resources (when added) ├── db/ │├── schema.cds          # Persistent entities │└── data/               # Optional seed CSV data ├── srv/ │├── monitoring-service.cds  # Exposed service definitions │└── monitoring-service.js   # Custom actions/handlers, if needed ├── test/                   # Tests (create when needed) ├── scripts/                # Simulator or seed scripts (create when needed) ├── docs/                   # Architecture and demo notes (optional) ├── package.json ├── package-lock.json ├── .gitignore └── README.md 

This is a target structure, not a claim that every file already exists. Keep the existing project structure if it was created by a supported CAP template, and add files gradually. 

### **18. Development roadmap** 

|**Milestone**|**Tasks**|**Definition of done**<br>**Estimate**|
|---|---|---|



Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

||Confirm Node/CAP|||
|---|---|---|---|
|M0 – Environment|versions, package.json,<br>npm install, cds watch,<br>Git.|Project starts reliably.|0.5–2 days|
|M1 – Data model|Define Interface,<br>QueueSnapshot and<br>Alert; load a small seed<br>set.|Model deploys and<br>sample records are<br>readable.|1–2 days|
|M2 – OData|Expose read services and<br>test endpoints.|Interfaces and alerts can<br>be queried.|1–2 days|
|M3 – Simulator|Create normal, retry<br>storm and recovery data.|Scenarios are repeatable.|2–3 days|
|M4 – Detection|Implement retry, queue<br>growth and backlog rules;<br>add tests.|All scripted scenarios<br>produce expected results.|2–4 days|
||Display interfaces,|Reviewer can operate the||
|M5 – UI|metrics and alerts; add<br>acknowledgement.|demo without manually<br>editing data.|2–4 days|
||Add runbook matching|AI response cites supplied||
|M6 – AI|and optional explanation<br>action.|runbook IDs and fails<br>safely.|2–4 days|
||README, architecture|Another developer can||
|M7 – Polish|diagram, test evidence<br>and demo script.|follow the setup and<br>reproduce the demo.|1–3 days|



A realistic beginner estimate is approximately 2–4 weeks for a working MVP with AI assistance and regular practice, or 4–6 weeks for a more polished result. Time depends on daily availability, SAP setup and troubleshooting. Live integrations and production hardening are outside this estimate. 

### **19. First setup and command checklist** 

Run commands from the project root, the folder containing package.json. 

# Check runtime and CAP CLI node --version npm --version cds --version 

# Install dependencies only when package.json exists and is valid npm install # Start CAP in development mode cds watch 

If npm reports that package.json is missing or invalid, inspect the file in the project root before running npm install. Do not paste PowerShell here-string markers such as @' or '@ into JSON files. Do not edit package-lock.json manually unless you have a specific reason; npm normally manages it. 

Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

#### **BAS versus local development** 

- BAS is the preferred place to learn the SAP cloud development workflow. 

- Local Windows PowerShell can be used for learning and testing CAP, but it is a separate runtime from BAS. 

- If using both Antigravity and BAS, use one Git repository as the source of truth and avoid editing the same files simultaneously. 

- Commit working milestones so you can return to a known-good state. 

- Do not assume that a local SQLite database or local environment is automatically shared with BAS. 

### **20. Demo scenarios and 10-minute script** 

|**Time**|**Demo activity**|**What to explain**|
|---|---|---|
|0:00–1:00|Introduce the problem and<br>architecture.|Retries can be useful, but repeated<br>failures plus incoming traffic can<br>create backlog.|
|1:00–2:00|Show normal interface traffic.|The system has a baseline state<br>and should not alert unnecessarily.|
|2:00–4:00|Run the retry storm scenario.|Retries and pending queue grow; a<br>deterministic rule triggers.|
|4:00–5:00|Open the alert details.|Show observed metrics, threshold<br>and time window.|
|5:00–6:00|Acknowledge the alert.|Demonstrate the human-operated<br>alert lifecycle.|
|6:00–8:00|Request AI explanation, if enabled.|Show runbook evidence and explain<br>that causes are hypotheses.|
|8:00–9:00|Run recovery scenario.|Queue starts draining; history<br>remains visible.|
|9:00–10:00|Show tests and README.|Demonstrate reproducibility and<br>project learning outcomes.|



### **21. Success criteria** 

- The app starts from documented instructions. 

- The simulator can produce normal, retry storm and recovery scenarios. 

- Detection rules behave as expected on the scripted test set. 

- Normal traffic does not trigger a critical retry-storm alert. 

- Alert evidence shows the values and thresholds that caused the rule to fire. 

- The user can acknowledge an alert. 

- AI explanations, if implemented, use runbook IDs and do not invent a confirmed root cause. 

- The app continues to work when AI is unavailable. 

- README explains setup, architecture, data model, testing and limitations. 

- A 10-minute demonstration can be completed without editing database files manually during the presentation. 

### **22. Main risks and mitigations** 

|**Risk**<br>**Why**|**it matters**<br>**Mitigation**|
|---|---|



Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

|Environment setup errors|Beginner may lose time to<br>package/config issues.|Keep M0 small; verify package.json<br>and CAP CLI before adding<br>features.|
|---|---|---|
|Unrealistic simulator|Rules may only work on ideal data.|Add transient spikes, normal<br>background traffic and recovery.|
|||Use multiple signals,|
|Too many false alerts|Thresholds may be too sensitive.|cooldown/deduplication and<br>scenario tests.|
|AI invents causes|A queue pattern alone cannot prove<br>root cause.|Ground output in evidence, label<br>hypotheses and cite runbook IDs.|
|BTP Trial limitations|HANA or AI services may not be<br>enabled.|Keep local SQLite and no-AI modes<br>fully functional.|
|Scope creep|UI, deployment and live integration<br>can overwhelm the MVP.|Freeze P0 scope and move stretch<br>features to a backlog.|
|Git conflicts or two copies|BAS and Antigravity changes can<br>diverge.|Use one repository, commits and a<br>clear pull/push routine.|



### **23. Project deliverables** 

- Working source repository. 

- CAP service and CDS model. 

- Repeatable simulator or seeded data. 

- Detection logic and automated tests. 

- Monitoring UI and alert acknowledgement. 

- Optional AI explanation module and runbook entries. 

- README with setup and troubleshooting instructions. 

- Architecture diagram and data model summary. 

- Screenshots or a short recording of the demo. 

- A short lessons-learned section explaining limitations and next steps. 

### **24. Future enhancements** 

- CSV import of anonymised aggregate metrics. 

- More sophisticated baselines per interface, time window and day of week. 

- Alert grouping and correlation across related interfaces. 

- Trend charts for queue size, retries and processing time. 

- Role-based access and audit history. 

- Notification integrations after alert quality is proven. 

- HANA Cloud or a suitable managed database if the deployment environment supports it. 

- Connection to real monitoring sources only after access, security and API contracts are approved. 

- A more advanced incident correlation feature that links multiple symptoms to a shared incident timeline. 

### **25. Questions for reviewer / mentor** 

- Is retry behaviour and queue growth a relevant problem in the team's work? 

- Are there anonymised examples of retry patterns or queue backlogs that can inform test data? 

Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

- Which integration types should the simulated example represent? 

- 

- 

- 

- 

- Is there an approved Gen AI provider or SAP Generative AI Hub access for this project? 

- Are there internal restrictions on sending log or operational data to an external model? 

- Which CAP, Node.js and UI template versions are preferred by the team? 

- Should the project remain a local prototype or should deployment be considered later? 

### **26. Reference resources** 

- SAP Developers tutorials: https://developers.sap.com/ 

- SAP CAP documentation: https://cap.cloud.sap/docs/ 

- SAP BTP documentation: https://help.sap.com/docs/btp 

- SAP Fiori elements documentation: https://ui5.sap.com/ 

- Use the current official documentation for setup commands and service availability because versions and trial entitlements can change. 

Note on references: this document is a project blueprint, not a verified assessment of any specific production environment. Validate current SAP service availability, supported package versions and organisational policies before implementation. 

### **Appendix A — Master prompt for AI coding assistance** 

Use this prompt in Antigravity or another coding assistant after opening the project repository: 

You are my beginner-friendly SAP CAP engineering mentor for Retry Storm Sentinel. 

Project goal: 

Build a prototype that simulates integration message retries, detects dangerous retry patterns and queue growth, displays alerts, and optionally uses Generative AI to explain evidence using a curated runbook. 

##### Stack: 

SAP CAP with Node.js, CDS, OData V4, SQLite for local development, and a UI added after the backend is reliable. The app must work without an AI provider. 

Rules for working: 

1. Inspect the existing files before changing anything. 

2. Explain the next small task before implementing it. 

3. Make incremental, reviewable changes; do not generate the entire app at once. 

4. Keep package.json valid and let npm manage package-lock.json. 

5. Use the current project template and installed versions rather than guessing. 

6. Explain unfamiliar SAP concepts in simple English. 

7. Run tests or provide exact commands to verify each change. 

8. Do not overwrite user work without asking. 

9. Do not expose or commit secrets. 

10. Do not add live SAP integration or paid services without approval. 

11. Detection must be deterministic and independent of AI. 

12. AI output must distinguish observed facts from hypotheses and cite runbook IDs. 

13. No automatic remediation. 

14. Update README when a milestone is completed. 

Learning prototype • Simulated data • Not production monitoring 

RETRY STORM SENTINEL  |  MASTER PROJECT DOCUMENT 

Work on one milestone at a time. First inspect the repository and tell me the smallest safe next step. Wait for the result of the test before moving on. 

### **Appendix B — Definition of done for the first milestone** 

- The correct project root is open. 

- package.json is valid JSON. 

- npm install completes without errors. 

- cds --version returns a version. 

- cds watch starts without a configuration or dependency error. 

- You can explain what package.json, db, srv and app are for at a beginner level. 

**End of master project document** 

Learning prototype • Simulated data • Not production monitoring 

