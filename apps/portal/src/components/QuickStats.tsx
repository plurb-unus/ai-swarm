import { getTemporalClient } from '@/lib/temporal';
import { Activity, CheckCircle2, XCircle, Wifi, WifiOff } from 'lucide-react';
import clsx from 'clsx';

interface Stats {
    running: number;
    completed: number;
    failed: number;
    pending: number;
}

export async function QuickStats() {
    let stats: Stats = { running: 0, completed: 0, failed: 0, pending: 0 };
    let connected = true;

    try {
        const client = await getTemporalClient();

        // Count running workflows
        const runningIterator = client.workflow.list({
            query: 'ExecutionStatus="Running"',
        });
        for await (const _ of runningIterator) {
            stats.running++;
            if (stats.running >= 100) break; // Cap for performance
        }

        // Count completed in last 24h
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const completedIterator = client.workflow.list({
            query: `ExecutionStatus="Completed" AND CloseTime > "${oneDayAgo}"`,
        });
        for await (const _ of completedIterator) {
            stats.completed++;
            if (stats.completed >= 100) break;
        }

        // Count failed in last 24h
        const failedIterator = client.workflow.list({
            query: `ExecutionStatus="Failed" AND CloseTime > "${oneDayAgo}"`,
        });
        for await (const _ of failedIterator) {
            stats.failed++;
            if (stats.failed >= 100) break;
        }
    } catch (e) {
        connected = false;
    }

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
                label="Running"
                value={stats.running}
                icon={Activity}
                colorClass="text-blue-500"
                bgClass="bg-blue-500/10"
                connected={connected}
            />
            <StatCard
                label="Completed (24h)"
                value={stats.completed}
                icon={CheckCircle2}
                colorClass="text-green-500"
                bgClass="bg-green-500/10"
                connected={connected}
            />
            <StatCard
                label="Failed (24h)"
                value={stats.failed}
                icon={XCircle}
                colorClass="text-red-500"
                bgClass="bg-red-500/10"
                connected={connected}
            />
            <StatCard
                label="Status"
                value={connected ? 'Connected' : 'Disconnected'}
                icon={connected ? Wifi : WifiOff}
                colorClass={connected ? "text-green-500" : "text-red-500"}
                bgClass={connected ? "bg-green-500/10" : "bg-red-500/10"}
                connected={connected}
                isStatus
            />
        </div>
    );
}

interface StatCardProps {
    label: string;
    value: number | string;
    icon: any;
    colorClass: string;
    bgClass: string;
    connected: boolean;
    isStatus?: boolean;
}

function StatCard({ label, value, icon: Icon, colorClass, bgClass, connected, isStatus }: StatCardProps) {
    return (
        <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm">
            <div className="flex items-center justify-between">
                <div className={clsx("p-2 rounded-lg", bgClass, colorClass)}>
                    <Icon className="h-5 w-5" />
                </div>
                {!connected && !isStatus && (
                    <span className="text-xs text-muted-foreground">--</span>
                )}
            </div>
            <div className="mt-4">
                <p className="text-2xl font-bold">
                    {connected || isStatus ? value : '--'}
                </p>
                <p className="text-sm text-muted-foreground font-medium">{label}</p>
            </div>
        </div>
    );
}
