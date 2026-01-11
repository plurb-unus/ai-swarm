'use client';

import { useState } from 'react';

export function ServiceLinks() {
    return (
        <div className="flex items-center gap-4 text-sm text-swarm-muted">
            <a
                href={`/temporal/namespaces/ai-swarm`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-swarm-blue transition-colors flex items-center gap-1"
            >
                <span>🕒</span>
                <span>Temporal</span>
            </a>

        </div>
    );
}
