import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import Graphene from "gi://Graphene";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Util from "resource:///org/gnome/shell/misc/util.js";

const INACTIVE_WORKSPACE_DOT_SCALE = 0.75;

const WorkspaceDot = GObject.registerClass(
  {
    Properties: {
      expansion: GObject.ParamSpec.double(
        "expansion",
        null,
        null,
        GObject.ParamFlags.READWRITE,
        0.0,
        1.0,
        0.0,
      ),
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
      this._dot.set({
        opacity: Util.lerp(0.5, 1.0, expansion) * 255,
        scaleX: Util.lerp(INACTIVE_WORKSPACE_DOT_SCALE, 1.0, expansion),
        scaleY: Util.lerp(INACTIVE_WORKSPACE_DOT_SCALE, 1.0, expansion),
      });
    }

    vfunc_get_preferred_width(forHeight) {
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

const WorkspaceIndicators = GObject.registerClass(
  class WorkspaceIndicators extends St.BoxLayout {
    constructor() {
      super();

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

      let widthMultiplier;
      if (nIndicators <= 2) widthMultiplier = 3.625;
      else if (nIndicators <= 5) widthMultiplier = 3.25;
      else widthMultiplier = 2.75;

      this.get_children().forEach((indicator, index) => {
        const distance = Math.abs(index - activeWorkspace);
        indicator.expansion = Math.clamp(1 - distance, 0, 1);
        indicator.widthMultiplier = widthMultiplier;
      });
    }
  },
);

let _patched = false;

function patchButton() {
  const button = Main.panel.statusArea.activities;
  if (!button) return;

  const logo = button
    .get_children()
    .find((c) => c.style_class?.includes("activities-logo"));
  if (!logo) return;

  button.remove_child(logo);
  logo.destroy();
  button.add_child(new WorkspaceIndicators());
  _patched = true;
}

export default class FixActivitiesExtension {
  enable() {
    _patched = false;
    patchButton();
  }

  disable() {
    if (!_patched) return;
    const button = Main.panel.statusArea.activities;
    if (!button) return;
    const wi = button
      .get_children()
      .find((c) => c instanceof WorkspaceIndicators);
    if (wi) {
      button.remove_child(wi);
      wi.destroy();
    }
  }
}
