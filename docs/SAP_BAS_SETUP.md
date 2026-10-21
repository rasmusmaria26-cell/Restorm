# Running and Deploying Retry Storm Sentinel in SAP Business Application Studio (BAS)

This guide walks you through running, testing, and deploying **Retry Storm Sentinel** inside **SAP Business Application Studio (BAS)** on SAP Business Technology Platform (BTP).

---

## 1. Quick Start: Local Testing in BAS (Development Mode)

In development mode, the app runs with in-memory SQLite and mocked authentication (`alice`, `bob`, `admin`), enabling full testing of all roles, scenarios, and AI incident analysis.

### Step 1: Open Terminal in BAS
Open a terminal in BAS via the top menu: `Terminal` $\rightarrow$ `New Terminal` (or press ``Ctrl + ` ``).

### Step 2: Configure Environment Variables
Copy the template and set your API key:
```bash
cp .env.example .env
```
Open `.env` in the BAS editor and set your key:
```ini
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=nvidia/nemotron-3.5-lightning:free
PORT=4004
```

### Step 3: Install Dependencies
```bash
npm install
```

### Step 4: Run the Development Server
```bash
cds watch
```
BAS will display a notification in the bottom right corner:
> **"A service is listening on port 4004. Open in a new tab."**

Click **Open in New Tab** (or use the BAS menu: `View` $\rightarrow$ `Find Command` $\rightarrow$ `Ports: Preview` $\rightarrow$ select port `4004`).

---

## 2. Testing Roles in BAS

The top-right header features a live role switcher:
- **Bob (Support Operator):** Can acknowledge alerts, resolve incidents, and trigger queue simulations.
- **Alice (Support Viewer):** Read-only view of interfaces and active incidents. Actions are disabled with explanatory tooltips.
- **Admin (Simulator Admin):** Full access, including administrative baseline resets (`resetToCleanSeed`).

---

## 3. Building the Enterprise MTA Archive

When you are ready to create an official SAP BTP Multi-Target Application archive (`.mtar`):

```bash
# 1. Run the Cloud MTA Build Tool (pre-installed in BAS)
mbt build
```

This compiles:
- `mta.yaml` specifications.
- Production CDS models (`npx cds build --production`) into `gen/srv`.
- The final deployable archive will be written to `mta_archives/retry-storm-sentinel_1.0.0.mtar`.

---

## 4. Deploying to SAP BTP Cloud Foundry

### Step 1: Log in to Cloud Foundry from BAS
From the BAS terminal:
```bash
cf login -a <CF_API_ENDPOINT>
```
Select your Target Org and Space.

### Step 2: Deploy the MTA Archive
```bash
cf deploy mta_archives/retry-storm-sentinel_1.0.0.mtar
```

### Step 3: Configure Environment Key in Cloud Foundry (Zero Git Secrets)
Instead of putting API keys in Git or container images, bind the key securely in BTP:
```bash
cf set-env retry-storm-sentinel-srv OPENROUTER_API_KEY "your_openrouter_api_key"
cf set-env retry-storm-sentinel-srv OPENROUTER_MODEL "nvidia/nemotron-3.5-lightning:free"
cf restage retry-storm-sentinel-srv
```

---

## 5. Assigning BTP Role Collections

After deployment, map real SAP BTP users in **BTP Cockpit** $\rightarrow$ **Security** $\rightarrow$ **Users**:
1. `RetryStorm_SupportViewer` $\rightarrow$ General support and operations teams.
2. `RetryStorm_SupportOperator` $\rightarrow$ Level-2/3 Integration Engineers (can acknowledge/resolve).
3. `RetryStorm_SimulatorAdmin` $\rightarrow$ Systems administrators.
