#!/usr/bin/env node
/**
 * AI Swarm v3 - CLI Tool
 *
 * Submit tasks and manage workflows from the command line.
 */

import { Command } from 'commander';
import { Client, Connection } from '@temporalio/client';

const program = new Command();

// =============================================================================
// CONFIGURATION
// =============================================================================

const config = {
    temporalAddress: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE || 'ai-swarm',
    taskQueue: process.env.TASK_QUEUE || 'ai-swarm-tasks',
};

// =============================================================================
// HELPERS
// =============================================================================

async function getClient(): Promise<Client> {
    const connection = await Connection.connect({
        address: config.temporalAddress,
    });
    return new Client({
        connection,
        namespace: config.namespace,
    });
}

// =============================================================================
// COMMANDS
// =============================================================================

program
    .name('ai-swarm')
    .description('AI Swarm CLI - Submit tasks and manage workflows')
    .version('3.0.0');

// Submit a task
program
    .command('submit')
    .description('Submit a new task to the swarm')
    .requiredOption('-t, --title <title>', 'Task title')
    .option('-c, --context <context>', 'Task context/description')
    .option('-a, --criteria <criteria...>', 'Acceptance criteria')
    .option('-f, --files <files...>', 'Files to modify')
    .option('-p, --priority <priority>', 'Priority (low, medium, high, critical)', 'medium')
    .option('--skip-approval', 'Skip human approval step')
    .action(async (options) => {
        try {
            const client = await getClient();

            const taskId = `task-${Date.now()}`;
            const workflowId = `develop-${taskId}`;

            console.log(`\n🚀 Submitting task: ${options.title}\n`);

            const handle = await client.workflow.start('developFeature', {
                taskQueue: config.taskQueue,
                workflowId,
                args: [
                    {
                        task: {
                            id: taskId,
                            title: options.title,
                            context: options.context || '',
                            acceptanceCriteria: options.criteria || [],
                            filesToModify: options.files || [],
                            priority: options.priority,
                            createdAt: new Date(),
                        },
                        skipApproval: options.skipApproval || false,
                        notifyOnComplete: true,
                    },
                ],
            });

            console.log(`✅ Workflow started!`);
            console.log(`   Workflow ID: ${handle.workflowId}`);
            console.log(`   Run ID: ${handle.firstExecutionRunId}`);
            console.log(`\n   View in Temporal UI: http://localhost:8233/namespaces/${config.namespace}/workflows/${workflowId}\n`);

            await client.connection.close();
        } catch (error) {
            console.error('❌ Failed to submit task:', error);
            process.exit(1);
        }
    });

// List workflows
program
    .command('list')
    .description('List recent workflows')
    .option('-n, --limit <number>', 'Number of workflows to show', '10')
    .option('-s, --status <status>', 'Filter by status (Running, Completed, Failed)')
    .action(async (options) => {
        try {
            const client = await getClient();

            let query = 'ORDER BY StartTime DESC';
            if (options.status) {
                query = `ExecutionStatus="${options.status}" ${query}`;
            }

            const iterator = client.workflow.list({ query });

            console.log('\n📋 Recent Workflows:\n');
            console.log('─'.repeat(80));

            let count = 0;
            const limit = parseInt(options.limit, 10);

            for await (const wf of iterator) {
                if (count >= limit) break;

                const status = wf.status.name;
                const statusIcon = status === 'Running' ? '🔄' : status === 'Completed' ? '✅' : '❌';

                console.log(`${statusIcon} ${wf.workflowId}`);
                console.log(`   Type: ${wf.type} | Status: ${status}`);
                console.log(`   Started: ${wf.startTime.toLocaleString()}`);
                console.log('─'.repeat(80));

                count++;
            }

            if (count === 0) {
                console.log('No workflows found.\n');
            }

            await client.connection.close();
        } catch (error) {
            console.error('❌ Failed to list workflows:', error);
            process.exit(1);
        }
    });

// Approve a workflow
program
    .command('approve <workflowId>')
    .description('Approve a workflow waiting for approval')
    .option('-c, --comment <comment>', 'Optional approval comment')
    .action(async (workflowId, options) => {
        try {
            const client = await getClient();
            const handle = client.workflow.getHandle(workflowId);

            console.log(`\n✅ Approving workflow: ${workflowId}\n`);

            await handle.signal('approval', true, options.comment);

            console.log('Approval signal sent!\n');

            await client.connection.close();
        } catch (error) {
            console.error('❌ Failed to approve workflow:', error);
            process.exit(1);
        }
    });

// Reject a workflow
program
    .command('reject <workflowId>')
    .description('Reject a workflow waiting for approval')
    .option('-c, --comment <comment>', 'Rejection reason')
    .action(async (workflowId, options) => {
        try {
            const client = await getClient();
            const handle = client.workflow.getHandle(workflowId);

            console.log(`\n❌ Rejecting workflow: ${workflowId}\n`);

            await handle.signal('approval', false, options.comment || 'Rejected via CLI');

            console.log('Rejection signal sent!\n');

            await client.connection.close();
        } catch (error) {
            console.error('❌ Failed to reject workflow:', error);
            process.exit(1);
        }
    });

// Cancel a workflow
program
    .command('cancel <workflowId>')
    .description('Cancel a running workflow')
    .action(async (workflowId) => {
        try {
            const client = await getClient();
            const handle = client.workflow.getHandle(workflowId);

            console.log(`\n🛑 Cancelling workflow: ${workflowId}\n`);

            await handle.signal('cancel');

            console.log('Cancel signal sent!\n');

            await client.connection.close();
        } catch (error) {
            console.error('❌ Failed to cancel workflow:', error);
            process.exit(1);
        }
    });

// Status of a workflow
program
    .command('status <workflowId>')
    .description('Get status of a workflow')
    .action(async (workflowId) => {
        try {
            const client = await getClient();
            const handle = client.workflow.getHandle(workflowId);
            const desc = await handle.describe();

            console.log(`\n📊 Workflow Status: ${workflowId}\n`);
            console.log(`   Type: ${desc.type}`);
            console.log(`   Status: ${desc.status.name}`);
            console.log(`   Started: ${desc.startTime.toLocaleString()}`);
            if (desc.closeTime) {
                console.log(`   Closed: ${desc.closeTime.toLocaleString()}`);
            }
            console.log(`   Task Queue: ${desc.taskQueue}`);
            console.log();

            await client.connection.close();
        } catch (error) {
            console.error('❌ Failed to get workflow status:', error);
            process.exit(1);
        }
    });

program.parse();
