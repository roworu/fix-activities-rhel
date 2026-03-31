import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import Graphene from "gi://Graphene";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Util from "resource:///org/gnome/shell/misc/util.js";

// Inactive workspace dots are slightly smaller so the current one stands out.
const INACTIVE_WORKSPACE_DOT_SCALE = 0.75;

// A single workspace indicator dot.
// This is a custom actor so we can animate both appearance and width.
const WorkspaceDot = GObject.registerClass(
  {
    Properties: {
      // 0..1 value that describes how "active" this dot is.
      // 1 means "this workspace is active", 0 means fully inactive.
      expansion: GObject.ParamSpec.double(
        "expansion",
        null,
        null,
        GObject.ParamFlags.READWRITE,
        0.0,
        1.0,
        0.0,
      ),
      // Width stretch factor used for the active-ish dot shape.
      // GNOME's upstream style makes the active dot wider than inactive dots.
      "width-multiplier": GObject.ParamSpec.double(
        "width-multiplier",
        null,
        null,
        GObject.ParamFlags.READWRITE,
        1.0,
        10.0,
        1.0,
      ),
    },
  },
  class WorkspaceDot extends Clutter.Actor {
    constructor(params = {}) {
      super({
        pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
        ...params,
      });

      this._dot = new St.Widget({
        style_class: "workspace-dot",
        y_align: Clutter.ActorAlign.CENTER,
        pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
        request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT,
      });
      this.add_child(this._dot);

      this.connect("notify::width-multiplier", () => this.queue_relayout());
      this.connect("notify::expansion", () => {
        this._updateVisuals();
        this.queue_relayout();
      });
      this._updateVisuals();
      this._destroying = false;
    }

    _updateVisuals() {
      const { expansion } = this;
      // Interpolate visual properties from inactive -> active.
      this._dot.set({
        opacity: Util.lerp(0.5, 1.0, expansion) * 255,
        scaleX: Util.lerp(INACTIVE_WORKSPACE_DOT_SCALE, 1.0, expansion),
        scaleY: Util.lerp(INACTIVE_WORKSPACE_DOT_SCALE, 1.0, expansion),
      });
    }

    vfunc_get_preferred_width(forHeight) {
      // Give active dots extra width while keeping inactive ones compact.
      const factor = Util.lerp(1.0, this.widthMultiplier, this.expansion);
      return this._dot
        .get_preferred_width(forHeight)
        .map((v) => Math.round(v * factor));
    }

    vfunc_get_preferred_height(forWidth) {
      return this._dot.get_preferred_height(forWidth);
    }

    vfunc_allocate(box) {
      this.set_allocation(box);
      box.set_origin(0, 0);
      this._dot.allocate(box);
    }

    scaleIn() {
      this.set({ scale_x: 0, scale_y: 0 });
      this.ease({
        duration: 500,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        scale_x: 1.0,
        scale_y: 1.0,
      });
    }

    scaleOutAndDestroy() {
      this._destroying = true;
      // Animate out first, then destroy so removing workspaces feels smooth.
      this.ease({
        duration: 500,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        scale_x: 0.0,
        scale_y: 0.0,
        onComplete: () => this.destroy(),
      });
    }

    get destroying() {
      return this._destroying;
    }
  },
);

// Container that manages one dot per workspace and keeps them in sync
// with GNOME Shell's dynamic workspace state.
const WorkspaceIndicators = GObject.registerClass(
  class WorkspaceIndicators extends St.BoxLayout {
    constructor(params = {}) {
      super(params);

      // Tracks current workspace index (`value`) and workspace count (`upper`).
      this._workspacesAdjustment = Main.createWorkspacesAdjustment(this);
      this._workspacesAdjustment.connectObject(
        "notify::value",
        () => this._updateExpansion(),
        "notify::upper",
        () => this._recalculateDots(),
        this,
      );

      for (let i = 0; i < this._workspacesAdjustment.upper; i++)
        this.insert_child_at_index(new WorkspaceDot(), i);
      this._updateExpansion();
    }

    _getActiveIndicators() {
      return [...this].filter((i) => !i.destroying);
    }

    _recalculateDots() {
      const activeIndicators = this._getActiveIndicators();
      const nIndicators = activeIndicators.length;
      const targetIndicators = this._workspacesAdjustment.upper;

      // Add or remove dots when workspace count changes.
      // We animate add/remove so lock/unlock and dynamic workspaces feel natural.
      let remaining = Math.abs(nIndicators - targetIndicators);
      while (remaining--) {
        if (nIndicators < targetIndicators) {
          const indicator = new WorkspaceDot();
          this.add_child(indicator);
          indicator.scaleIn();
        } else {
          const indicator = activeIndicators[nIndicators - remaining - 1];
          indicator.scaleOutAndDestroy();
        }
      }
      this._updateExpansion();
    }

    _updateExpansion() {
      const nIndicators = this._getActiveIndicators().length;
      const activeWorkspace = this._workspacesAdjustment.value;

      // Keep total width reasonable when many workspaces exist.
      let widthMultiplier;
      if (nIndicators <= 2) widthMultiplier = 3.625;
      else if (nIndicators <= 5) widthMultiplier = 3.25;
      else widthMultiplier = 2.75;

      this.get_children().forEach((indicator, index) => {
        const distance = Math.abs(index - activeWorkspace);
        // Nearest dot gets expansion near 1; farther ones approach 0.
        indicator.expansion = Math.clamp(1 - distance, 0, 1);
        indicator.widthMultiplier = widthMultiplier;
      });
    }
  },
);

let _sessionSignal = null;
const INJECTED_INDICATORS_NAME = "fix-activities-rhel-indicators";
const RHEL_ACTIVITIES_LOGO_CLASS = "activities-logo";
const RHEL_ACTIVITIES_LOGO_ICON = "fedora-logo-icon";

function patchButton() {
    // GNOME panel "Activities" button host.
    const button = Main.panel.statusArea.activities;
    if (!button) return;

    // RHEL patch adds a branding logo widget; remove it if present.
    const logo = button.get_children().find(
        c => c.style_class?.includes(RHEL_ACTIVITIES_LOGO_CLASS)
    );

    // Avoid duplicating indicators if enable/updated runs multiple times.
    const already = button.get_children().find(
        c => c.name === INJECTED_INDICATORS_NAME
            || c._fixActivitiesRhelInjected === true
    );
    if (already) return;

    // Only patch RHEL's branding variant. On upstream/non-branded builds,
    // do nothing to avoid duplicating the stock workspace indicators.
    if (!logo) return;

    button.remove_child(logo);
    logo.destroy();

    // Insert our workspace indicator replacement.
    const indicators = new WorkspaceIndicators({
        name: INJECTED_INDICATORS_NAME,
    });
    indicators._fixActivitiesRhelInjected = true;
    button.add_child(indicators);
}

export default class FixActivitiesExtension {
    enable() {
        if (_sessionSignal) {
            Main.sessionMode.disconnect(_sessionSignal);
            _sessionSignal = null;
        }

        patchButton();

        // Lock/unlock can rebuild panel actors; re-apply after unlock.
        _sessionSignal = Main.sessionMode.connect('updated', () => {
            if (!Main.sessionMode.isLocked)
                patchButton();
        });
    }

    disable() {
        if (_sessionSignal) {
            Main.sessionMode.disconnect(_sessionSignal);
            _sessionSignal = null;
        }

        // Remove only what this extension added.
        const button = Main.panel.statusArea.activities;
        if (!button) return;
        const injectedIndicators = button.get_children().filter(c => {
            if (c.name === INJECTED_INDICATORS_NAME || c._fixActivitiesRhelInjected === true)
                return true;
            if (c instanceof WorkspaceIndicators)
                return true;

            // Fallback for indicators created by older extension revisions.
            if (typeof c.get_children !== "function")
                return false;
            return c.get_children().some(child => child.style_class?.includes("workspace-dot"));
        });

        injectedIndicators.forEach(indicators => {
            button.remove_child(indicators);
            indicators.destroy();
        });

        // Restore the original RHEL branding icon we replaced in enable().
        const hasLogo = button.get_children().some(
            c => c.style_class?.includes(RHEL_ACTIVITIES_LOGO_CLASS)
        );
        if (!hasLogo) {
            button.add_child(new St.Icon({
                icon_name: RHEL_ACTIVITIES_LOGO_ICON,
                style_class: RHEL_ACTIVITIES_LOGO_CLASS,
            }));
        }
    }
}
