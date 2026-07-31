export const normalizeGitHubLabelName = (name) => name.toLowerCase()

export const indexGitHubLabels = (labels) =>
  new Map(labels.map((label) => [normalizeGitHubLabelName(label.name), label]))

export const githubLabelNameSet = (labels) => new Set(labels.map((label) => normalizeGitHubLabelName(label.name)))
