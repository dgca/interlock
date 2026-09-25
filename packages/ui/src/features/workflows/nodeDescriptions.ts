import type { WorkflowNode } from '@interlock/core';

export const nodeDescriptions: Record<WorkflowNode['kind'], string> = {
  entry: 'Starts the workflow with the input supplied for this run.',
  exit: 'Finishes the workflow and returns the result.',
  agent:
    'Pauses for an agent or person to complete an assignment and return a result.',
  script: 'Runs JavaScript or Bash to transform data or perform a task.',
  fetch: 'Sends an HTTP request and returns the response.',
  wait: 'Pauses for a duration or until a specified time, then continues with the same input.',
  condition:
    'Checks a value and follows the True or False branch. The input stays unchanged.',
  switch:
    'Checks a value and follows one matching branch. The input stays unchanged.',
  workflow: 'Runs a published workflow and continues with its result.',
  batch:
    'Runs the same steps for each item in a list and collects the results.',
};
