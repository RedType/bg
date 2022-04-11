import * as pipes from 'aws-cdk-lib/pipelines';

export interface PollParameterStepProps {
  parameter: string;
  pollPeriod?: number;
  until?: string;
  untilNot?: string;
}

export default class PollParameterStep extends pipes.ShellStep {
  private static readonly DEFAULT_POLL_PERIOD = 30; // seconds

  constructor(name: string, props: PollParameterStepProps) {
    if (!props.until && !props.untilNot) {
      throw new Error('One of `until` or `untilNot` must be given in props');
    }

    const oper = props.until ? '==' : '!=';
    const target = props.until || props.untilNot;
    const fetchCommand =
      `aws ssm get-parameter --name ${props.parameter} ` +
      '| jq ".Parameter.Value" ' +
      '| xargs echo'
    ;

    super(name, {
      commands: [
        'while true; do',
          `PARAM_VALUE=$(${fetchCommand})`,
          `if [[ "$PARAM_VALUE" ${oper} ${target} ]]; then`,
            'break',
          'else',
            `sleep ${props.pollPeriod ?? PollParameterStep.DEFAULT_POLL_PERIOD}`,
          'fi',
        'done',
      ],
    });
  }
}

