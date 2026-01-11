# AI Swarm IDE Integration

> Submit tasks to AI Swarm from any AI IDE or CLI tool

This prompt can be added to your AI tool's system prompt or used as a slash command (e.g., `/submit-swarm` in Antigravity).

---

## Prerequisites

Before using this integration:

1. **SSH Access**: You must have SSH access to your AI Swarm server
2. **Project ID**: Get your project ID from the AI Swarm portal at `/settings/projects`
3. **Server Alias**: Configure an SSH alias (e.g., `swarm-server`) for passwordless access

---

## The Prompt

Copy everything below this line into your AI tool's system prompt or customization:

---

```markdown
## AI Swarm Task Submission

When the user asks to "submit to AI Swarm", "send to swarm", or similar:

### Step 1: Gather Task Details

Ask clarifying questions until you have:

| Field | Required | Description |
|-------|----------|-------------|
| **Title** | Yes | Clear, concise task title |
| **Context** | Yes | What needs to be done and why |
| **Acceptance Criteria** | Yes | Specific, testable requirements (as array) |
| **Files to Modify** | No | Hint at which files to change |
| **Project ID** | Yes | UUID from AI Swarm portal |
| **Skip Approval** | No | Default: false (require human approval) |

### Step 2: Generate Submission Command

Create a JSON file and submit via SSH + tctl:

```bash
# Create the task payload
cat > /tmp/swarm-task.json << 'EOF'
{
  "task": {
    "id": "task-YYYYMMDD-HHMMSS",
    "title": "<TASK_TITLE>",
    "context": "<TASK_CONTEXT>",
    "acceptanceCriteria": ["<CRITERION_1>", "<CRITERION_2>"],
    "filesToModify": ["<FILE_1>", "<FILE_2>"],
    "priority": "medium",
    "type": "feature",
    "projectId": "<PROJECT_ID>",
    "createdAt": "<ISO_TIMESTAMP>"
  },
  "projectId": "<PROJECT_ID>",
  "skipApproval": false,
  "notifyOnComplete": true
}
EOF

# Submit to AI Swarm via SSH
scp /tmp/swarm-task.json <SERVER>:/tmp/swarm-task.json
ssh <SERVER> "docker cp /tmp/swarm-task.json temporal:/tmp/swarm-task.json && \
  docker exec temporal tctl --address temporal:7233 --namespace ai-swarm \
  workflow start --taskqueue ai-swarm-tasks --workflow_type developFeature \
  --workflow_id task-YYYYMMDD-HHMMSS --input_file /tmp/swarm-task.json"
```

Replace:
- `<SERVER>` with the SSH alias (e.g., `swarm-server`)
- `<PROJECT_ID>` with the UUID from `/settings/projects`
- `<TASK_TITLE>`, `<TASK_CONTEXT>`, etc. with gathered details

### Step 3: Confirm Submission

After running the command, tell the user:
- The workflow ID
- Link to monitor: `https://<PORTAL_DOMAIN>/workflows`
- Link to Temporal UI: `https://<PORTAL_DOMAIN>/temporal/namespaces/ai-swarm`

### Task Format Best Practices

**Good Task:**
```
Title: Add loading states to all form buttons

Context: Currently buttons don't show feedback when clicked,
leading to double-clicks and poor UX. Need to add a loading
prop that shows a spinner and disables the button.

Acceptance Criteria:
- All Button components accept `loading` prop
- Loading state shows spinner and disables button
- Unit tests verify loading behavior

Files to consider:
- src/components/Button.tsx
- src/components/forms/*.tsx
```

**Bad Task:**
```
Title: Fix the button thing
Context: It's broken
(Too vague - AI Swarm can't create a good implementation plan)
```
```

---

## Quick Reference

### Task JSON Structure

```json
{
  "task": {
    "id": "unique-task-id",
    "title": "Task title",
    "context": "Detailed description",
    "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
    "filesToModify": ["path/to/file.ts"],
    "priority": "low|medium|high",
    "type": "feature|fix|refactor",
    "projectId": "uuid-from-portal",
    "createdAt": "2025-01-01T00:00:00Z"
  },
  "projectId": "uuid-from-portal",
  "skipApproval": false,
  "notifyOnComplete": true
}
```

### Workflow Types

| Type | Description |
|------|-------------|
| `feature` | New functionality |
| `fix` | Bug fix |
| `refactor` | Code improvement without behavior change |

### Priority Levels

| Priority | Behavior |
|----------|----------|
| `low` | Standard queue processing |
| `medium` | Default priority |
| `high` | Processed before lower priority tasks |

---

## Monitoring

After submission, monitor your task:

- **Portal Dashboard**: `https://<PORTAL_DOMAIN>/workflows`
- **Temporal UI**: `https://<PORTAL_DOMAIN>/temporal/namespaces/ai-swarm`

## Kill Switch

If something goes wrong, pause all AI Swarm operations:

```bash
ssh <SERVER> "curl -X POST http://localhost:3000/api/swarm -d '{\"action\":\"pause\"}' -H 'Content-Type: application/json'"
```

Resume with:

```bash
ssh <SERVER> "curl -X POST http://localhost:3000/api/swarm -d '{\"action\":\"resume\"}' -H 'Content-Type: application/json'"
```

---

*AI Swarm v3.0.0 — Autonomous Development Orchestration*
