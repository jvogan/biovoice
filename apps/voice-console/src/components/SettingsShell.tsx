import { SettingsDrawer, type SettingsDrawerProps } from "./SettingsDrawer";
import { WorkflowsPanel, type WorkflowsPanelProps } from "./WorkflowsPanel";

export interface SettingsShellProps extends Omit<SettingsDrawerProps, "workflowsContent"> {
  workflowsPanelProps: WorkflowsPanelProps;
}

export function SettingsShell(props: SettingsShellProps) {
  const { workflowsPanelProps, ...drawerProps } = props;
  return (
    <SettingsDrawer
      {...drawerProps}
      workflowsContent={<WorkflowsPanel {...workflowsPanelProps} />}
    />
  );
}
