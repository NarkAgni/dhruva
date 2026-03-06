export default class WorkspaceFilter {

    static filterWindows(windows, settings) {
        try {
            if (!settings.get_boolean('isolate-workspaces')) return windows;
        } catch (e) {
            return windows;
        }

        const workspaceManager = global.workspace_manager;
        const activeWs = workspaceManager.get_active_workspace();

        return windows.filter(w => {
            return w.is_on_all_workspaces() || w.get_workspace() === activeWs;
        });
    }
}