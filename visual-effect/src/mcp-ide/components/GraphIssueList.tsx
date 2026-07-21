import type { McpGraphIssue } from "../model/McpGraphDocument"

interface GraphIssueListProps {
  readonly issues: ReadonlyArray<McpGraphIssue>
}

export function GraphIssueList({ issues }: GraphIssueListProps) {
  if (issues.length === 0) return null

  return (
    <ul className="graph-issue-list" aria-label="Graph validation issues">
      {issues.map(issue => (
        <li key={`${issue.code}-${issue.path}`} data-testid={`graph-issue-${issue.code}`}>
          <span>
            {issue.code} / {issue.path} / {issue.repair.actionId}
          </span>
          <p>{issue.message}</p>
          <div className="graph-repair">
            <b>{issue.repair.description}</b>
            {issue.repair.alternatives.length > 0 && (
              <ul>
                {issue.repair.alternatives.map(option => (
                  <li key={option.id}>{option.label}</li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
