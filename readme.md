## fix-activities-rhel

Restores the upstream GNOME Shell workspace indicator dots in the Activities button, overriding a RHEL-specific patch that replaces them with a Red Hat logo.

### Why this exists

RHEL ships a patched `panel.js` that modifies the `ActivitiesButton` constructor: if the OS is detected as RHEL (via `GLib.get_os_info('ID') === 'rhel'`), it replaces the `WorkspaceIndicators` widget with an `St.Icon` showing a Red Hat logo. 
This removes genuinely useful functionality - the workspace dots show which desktop you are currently on and how many exist - in favour of a static branding icon that communicates nothing at runtime.


### Showcase

![Before](/assets/before.png)
![After](/assets/after.png)