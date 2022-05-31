import * as core from '@actions/core'
import * as github from '@actions/github'
import { ChangeSet, findChangeSet } from './history'
import { getCommit } from './queries/commit'
import { getAssociatedPullRequestsInCommitHistoryOfSubTreeQuery } from './queries/history'

type Inputs = {
  token: string
  base: string
  head: string
  path: string
  groupByPaths: string[]
  showOthersGroup: boolean
}

type Outputs = {
  body: string
  associatedPullRequests: number[]
}

export const computeChangeSetBetweenBaseHead = async (inputs: Inputs): Promise<Outputs> => {
  const octokit = github.getOctokit(inputs.token)

  const baseCommit = await getCommit(octokit, {
    owner: github.context.repo.owner,
    name: github.context.repo.repo,
    expression: inputs.base,
  })
  core.startGroup(`Base commit of ${inputs.base}`)
  core.info(JSON.stringify(baseCommit, undefined, 2))
  core.endGroup()
  if (baseCommit.repository?.object?.__typename !== 'Commit') {
    throw new Error(`unexpected typename ${String(baseCommit.repository?.object?.__typename)} !== Commit`)
  }

  const history = await getAssociatedPullRequestsInCommitHistoryOfSubTreeQuery(octokit, {
    owner: github.context.repo.owner,
    name: github.context.repo.repo,
    expression: inputs.head,
    path: inputs.path,
    since: baseCommit.repository.object.committedDate,
  })
  core.startGroup(`Commit history on ${inputs.head} since ${baseCommit.repository.object.committedDate}`)
  core.info(JSON.stringify(history, undefined, 2))
  core.endGroup()
  const changeSet = findChangeSet(history, baseCommit.repository.object.oid)

  if (inputs.groupByPaths.length === 0) {
    return {
      body: [...changeSet.pullOrCommits].map((s) => `- ${s}`).join('\n'),
      associatedPullRequests: [...changeSet.pulls],
    }
  }

  const pathChangeSets = new Map<string, ChangeSet>()
  for (const path of inputs.groupByPaths) {
    const history = await getAssociatedPullRequestsInCommitHistoryOfSubTreeQuery(octokit, {
      owner: github.context.repo.owner,
      name: github.context.repo.repo,
      expression: inputs.head,
      path,
      since: baseCommit.repository.object.committedDate,
    })
    core.startGroup(`Commit history of sub tree ${path}`)
    core.info(JSON.stringify(history, undefined, 2))
    core.endGroup()
    const changeSet = findChangeSet(history, baseCommit.repository.object.oid)
    pathChangeSets.set(path, changeSet)
  }

  const otherPullOrCommits = new Set(changeSet.pullOrCommits)
  const body = []
  for (const [path, { pullOrCommits }] of pathChangeSets) {
    if (pullOrCommits.size > 0) {
      body.push(`### ${path}`)
      for (const pullOrCommit of pullOrCommits) {
        body.push(`- ${pullOrCommit}`)
        otherPullOrCommits.delete(pullOrCommit)
      }
    }
  }
  if (inputs.showOthersGroup && otherPullOrCommits.size > 0) {
    body.push(`### Others`)
    for (const pullOrCommit of otherPullOrCommits) {
      body.push(`- ${pullOrCommit}`)
    }
  }

  return {
    body: body.join('\n'),
    associatedPullRequests: [...changeSet.pulls],
  }
}