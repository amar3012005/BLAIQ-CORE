// BLAIQ Admin · Work wall — ClickUp track view across all jobs.
// Groups jobs by revision state so open work is visible at a glance.

'use client';

import React, { useEffect, useState } from 'react';
import { listJobs, type Job } from './api';
import { PAL, monoSmall, sansBold, sans, pill, emptyText } from './theme';
import { ErrorBanner, SkeletonList } from './ProjectsBoard';

type Column = { id: string; label: string; filter: (j: Job) => boolean };

const COLUMNS: Column[] = [
  {
    id: 'open',
    label: 'Open / In Progress',
    filter: (j) => j.delivery_status === 'in_progress' && j.revision_count === 0,
  },
  {
    id: 'revision',
    label: 'In Revision',
    filter: (j) => j.delivery_status === 'in_progress' && j.revision_count > 0,
  },
  {
    id: 'delivered',
    label: 'Delivered',
    filter: (j) => j.delivery_status === 'delivered',
  },
];

function JobCard({ job }: { job: Job }): JSX.Element {
  const ticketCount = job.clickup_ticket_ids?.length ?? 0;
  return (
    <div
      style={{
        background: PAL.white,
        border: `1px solid ${PAL.divider}`,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ ...monoSmall, color: PAL.muted, fontSize: 9 }}>{job.job_number}</span>
        {job.revision_count > 0 && (
          <span style={pill('#F97316')}>{`R${job.revision_count}`}</span>
        )}
      </div>
      <div style={{ ...sansBold, fontSize: 12, color: PAL.ink }}>{job.title}</div>
      {job.client && (
        <div style={{ ...sans, fontSize: 11, color: PAL.muted }}>{job.client}</div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
        {job.clickup_folder_id && (
          <span style={pill()}>{`CU folder`}</span>
        )}
        {ticketCount > 0 && (
          <span style={{ ...sans, fontSize: 10, color: PAL.muted }}>
            {ticketCount} ticket{ticketCount !== 1 ? 's' : ''}
          </span>
        )}
        {job.server_folder_path && (
          <span style={{ ...monoSmall, fontSize: 9, color: PAL.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
            {job.server_folder_path.split('/').pop()}
          </span>
        )}
      </div>
    </div>
  );
}

export default function TasksWall(): JSX.Element {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listJobs()
      .then((j) => setJobs(j))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto' }}>
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 16 }}>
        WORK · CLICKUP TRACK
      </div>
      {error && <ErrorBanner message={error} />}
      {!jobs && !error && <SkeletonList />}
      {jobs && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 16,
          }}
        >
          {COLUMNS.map((col) => {
            const items = jobs.filter(col.filter);
            return (
              <div
                key={col.id}
                style={{
                  background: PAL.panel,
                  border: `1px solid ${PAL.divider}`,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minHeight: 200,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ ...monoSmall, color: PAL.ink }}>{col.label}</span>
                  <span style={{ ...monoSmall, color: PAL.muted }}>{items.length}</span>
                </div>
                {items.length === 0 && <div style={emptyText}>Empty.</div>}
                {items.map((j) => <JobCard key={j.id} job={j} />)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
