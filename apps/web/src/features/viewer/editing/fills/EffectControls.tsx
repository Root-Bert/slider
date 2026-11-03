import {
  NO_EFFECTS,
  stopOpacity,
  type EditableElement,
  type ElementEffects,
  type ElementGlow,
  type ElementShadow,
  type FillLayer,
} from '@slider/shared';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { cn, IconButton, NumberField, SegmentedControl } from '@/ui';
import { useEditing } from '../editing-context';
import { ColorField, HexField, PercentField } from '../colors/ColorPalette';

/*
 * The effects under the fill, as a design tool lists them: a shadow, a blur (its edges soft), a
 * glow – each at most once, as LibreOffice draws them – and a backdrop blur (frosted glass: what
 * lies behind shows blurred through the fill), which the server bakes into the fill as a picture.
 * A click on a row opens it below the list.
 */

export type EffectKind = keyof ElementEffects;

/** `short`: its name in the row of kinds, where the whole one does not fit (its tooltip then). */
const ALL_KINDS: { value: EffectKind; label: string; short?: string }[] = [
  { value: 'shadow', label: 'Schatten' },
  { value: 'blur', label: 'Weichzeichnen' },
  { value: 'glow', label: 'Leuchten' },
  { value: 'backdrop', label: 'Hintergrund-Unschärfe', short: 'Unschärfe' },
];

const NEW_SHADOW: ElementShadow = { x: 0, y: 4, blur: 12, color: '#000000', opacity: 0.25 };
const NEW_BLUR = 6;
const NEW_GLOW: ElementGlow = { radius: 8, color: '#ffcc00', opacity: 0.6 };
const NEW_BACKDROP = 12;
/** How opaque a fill is made when a backdrop blur comes and nothing would show through it. */
const GLASS_OPACITY = 0.4;

const fresh = (kind: EffectKind, effects: ElementEffects): ElementEffects => ({
  ...effects,
  ...(kind === 'shadow' ? { shadow: NEW_SHADOW } : kind === 'blur' ? { blur: NEW_BLUR } : {}),
  ...(kind === 'glow' ? { glow: NEW_GLOW } : kind === 'backdrop' ? { backdrop: NEW_BACKDROP } : {}),
});

function summary(kind: EffectKind, effects: ElementEffects): string {
  const { shadow, blur, glow, backdrop } = effects;
  if (kind === 'shadow' && shadow) return `Schatten ${pt(shadow.blur)}`;
  if (kind === 'blur' && blur) return `Weichzeichnen ${pt(blur)}`;
  if (kind === 'glow' && glow) return `Leuchten ${pt(glow.radius)}`;
  if (kind === 'backdrop' && backdrop) return `Hintergrund-Unschärfe ${pt(backdrop)}`;
  return '';
}

/** A layer nothing shows through: a colour or gradient fully opaque. */
const opaque = (layer: FillLayer) =>
  layer.visible &&
  layer.type !== 'image' &&
  layer.opacity >= 1 &&
  (layer.type !== 'gradient' || layer.stops.every((stop) => stopOpacity(stop) >= 1));

/**
 * The fill a backdrop blur comes with, so it shows: none – a white one, see-through; one colour
 * or gradient nothing shows through – that one see-through. `null`: left as it is.
 */
function glassFills(fills: readonly FillLayer[]): FillLayer[] | null {
  const shown = fills.filter((layer) => layer.visible);
  if (shown.length === 0)
    return [...fills, { type: 'solid', color: '#ffffff', opacity: GLASS_OPACITY, visible: true }];
  const [only] = shown;
  if (shown.length !== 1 || !only || !opaque(only)) return null;
  return fills.map((layer) => (layer === only ? { ...layer, opacity: GLASS_OPACITY } : layer));
}

const pt = (value: number) => `${Math.round(value * 10) / 10} pt`;

/**
 * `only`: the effects offered here – a text's tab offers the shadow alone, the one LibreOffice
 * draws on letters (`letterShadow`); the others stay as they are.
 */
export function EffectControls({
  element,
  only,
  label = 'Effekte',
}: {
  element: EditableElement;
  only?: readonly EffectKind[];
  label?: string;
}) {
  const editing = useEditing();
  const effects = element.look?.effects ?? NO_EFFECTS;
  const [open, setOpen] = useState<EffectKind | null>(null);
  const KINDS = only ? ALL_KINDS.filter((kind) => only.includes(kind.value)) : ALL_KINDS;
  const fills = element.look?.fills ?? [];
  const change = (next: ElementEffects, coalesce?: string) => {
    // A backdrop blur coming: a fill nothing would show through becomes see-through with it.
    const glass = next.backdrop !== null && effects.backdrop === null ? glassFills(fills) : null;
    void editing.apply(
      [
        {
          type: 'setShapeStyle',
          elementId: element.id,
          effects: next,
          ...(glass ? { fills: glass } : {}),
        },
      ],
      { coalesce: coalesce && `effects:${coalesce}:${element.id}` },
    );
  };
  const shown = KINDS.filter((kind) => effects[kind.value] !== null);
  const missing = KINDS.find((kind) => effects[kind.value] === null);
  const add = () => {
    if (!missing) return;
    change(fresh(missing.value, effects));
    setOpen(missing.value);
  };
  const remove = (kind: EffectKind) => {
    change({ ...effects, [kind]: null });
    if (open === kind) setOpen(null);
  };
  /** The opened effect becomes another kind: the old one goes, the new one comes as new. */
  const become = (from: EffectKind, to: EffectKind) => {
    if (from === to) return;
    change(fresh(to, { ...effects, [from]: null }));
    setOpen(to);
  };
  const opened = open && effects[open] !== null ? open : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="mr-auto text-xs text-fg-subtle">{label}</span>
        <IconButton
          icon="add"
          label="Effekt hinzufügen"
          size="compact"
          disabled={!missing}
          onClick={add}
        />
      </div>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label="Effekte">
          {shown.map(({ value: kind }) => (
            <li
              key={kind}
              className={cn(
                'flex items-center gap-1 rounded-control-sm py-0.5 pr-0.5 pl-5',
                open === kind && 'bg-selected',
              )}
            >
              <button
                type="button"
                aria-label="Effekt bearbeiten"
                aria-expanded={open === kind}
                onClick={() => setOpen((current) => (current === kind ? null : kind))}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-control-sm text-left focus-visible:outline-2 focus-visible:outline-border-focus"
              >
                <EffectSwatch kind={kind} effects={effects} />
                <span className="truncate text-xs text-fg tabular-nums">
                  {summary(kind, effects)}
                </span>
              </button>
              <IconButton
                icon="remove"
                label="Effekt entfernen"
                size="compact"
                onClick={() => remove(kind)}
              />
            </li>
          ))}
        </ul>
      )}
      {opened && (
        <div className="mt-1 flex flex-col gap-2 rounded-control-sm bg-surface-1 p-2">
          {KINDS.length > 1 && (
            <SegmentedControl
              segments={KINDS.map((kind) => ({
                value: kind.value,
                label: kind.short ?? kind.label,
                title: kind.label,
                disabled: kind.value !== opened && effects[kind.value] !== null,
              }))}
              value={opened}
              onChange={(kind) => become(opened, kind)}
              label="Art des Effekts"
              size="xs"
              track="soft"
              fill
            />
          )}
          {opened === 'shadow' && effects.shadow && (
            <ShadowEditor
              shadow={effects.shadow}
              onChange={(shadow, coalesce) => change({ ...effects, shadow }, coalesce)}
            />
          )}
          {opened === 'blur' && effects.blur !== null && (
            <Row label="Stärke">
              <PointField
                label="Weichzeichnen (pt)"
                value={effects.blur}
                min={0.5}
                onChange={(blur) => change({ ...effects, blur }, 'blur')}
              />
            </Row>
          )}
          {opened === 'backdrop' && effects.backdrop !== null && (
            <>
              <Row label="Stärke">
                <PointField
                  label="Hintergrund-Unschärfe (pt)"
                  value={effects.backdrop}
                  min={0.5}
                  onChange={(backdrop) => change({ ...effects, backdrop }, 'backdrop')}
                />
              </Row>
              {fills.some(opaque) && (
                <p className="text-xs text-fg-subtle">
                  Scheint nur durch eine durchsichtige Füllung.
                </p>
              )}
            </>
          )}
          {opened === 'glow' && effects.glow && (
            <GlowEditor
              glow={effects.glow}
              onChange={(glow, coalesce) => change({ ...effects, glow }, coalesce)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ShadowEditor({
  shadow,
  onChange,
}: {
  shadow: ElementShadow;
  onChange: (shadow: ElementShadow, coalesce?: string) => void;
}) {
  return (
    <>
      <Row label="Versatz">
        <PointField
          label="Versatz nach rechts (pt)"
          prefix="X"
          value={shadow.x}
          min={-200}
          onChange={(x) => onChange({ ...shadow, x }, 'shadow-x')}
        />
        <PointField
          label="Versatz nach unten (pt)"
          prefix="Y"
          value={shadow.y}
          min={-200}
          onChange={(y) => onChange({ ...shadow, y }, 'shadow-y')}
        />
      </Row>
      <Row label="Unschärfe">
        <PointField
          label="Unschärfe (pt)"
          value={shadow.blur}
          min={0}
          onChange={(blur) => onChange({ ...shadow, blur }, 'shadow-blur')}
        />
      </Row>
      <Row label="Farbe">
        <ColorField
          label="Schattenfarbe"
          value={shadow.color}
          onChange={(color) => onChange({ ...shadow, color }, 'shadow-color')}
          opacity={shadow.opacity}
          onOpacity={(opacity) => onChange({ ...shadow, opacity }, 'shadow-opacity')}
        />
        <HexField value={shadow.color} onChange={(color) => onChange({ ...shadow, color })} />
        <PercentField
          label="Deckkraft (%)"
          value={shadow.opacity}
          onChange={(opacity) => onChange({ ...shadow, opacity }, 'shadow-opacity')}
        />
      </Row>
    </>
  );
}

function GlowEditor({
  glow,
  onChange,
}: {
  glow: ElementGlow;
  onChange: (glow: ElementGlow, coalesce?: string) => void;
}) {
  return (
    <>
      <Row label="Größe">
        <PointField
          label="Größe des Leuchtens (pt)"
          value={glow.radius}
          min={0.5}
          onChange={(radius) => onChange({ ...glow, radius }, 'glow-radius')}
        />
      </Row>
      <Row label="Farbe">
        <ColorField
          label="Farbe des Leuchtens"
          value={glow.color}
          onChange={(color) => onChange({ ...glow, color }, 'glow-color')}
          opacity={glow.opacity}
          onOpacity={(opacity) => onChange({ ...glow, opacity }, 'glow-opacity')}
        />
        <HexField value={glow.color} onChange={(color) => onChange({ ...glow, color })} />
        <PercentField
          label="Deckkraft (%)"
          value={glow.opacity}
          onChange={(opacity) => onChange({ ...glow, opacity }, 'glow-opacity')}
        />
      </Row>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-fg-subtle">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A length in points (`NumberField`); its prefix („X“) is its handle. */
function PointField({
  label,
  value,
  min,
  prefix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  prefix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <NumberField
      label={label}
      mark={prefix}
      unit="pt"
      value={Math.round(value * 10) / 10}
      onChange={onChange}
      min={min}
      max={200}
      step={1}
      decimals={1}
    />
  );
}

/** The effect on a small square, as the fill rows show their layer. */
function EffectSwatch({ kind, effects }: { kind: EffectKind; effects: ElementEffects }) {
  const { shadow, blur, glow, backdrop } = effects;
  const hex = (color: string, opacity: number) =>
    `${color}${Math.round(opacity * 255)
      .toString(16)
      .padStart(2, '0')}`;
  const style: CSSProperties =
    kind === 'shadow' && shadow
      ? {
          boxShadow: `${Math.sign(shadow.x) * 1.5}px ${Math.sign(shadow.y) * 1.5}px ${shadow.blur > 0 ? 3 : 0}px ${hex(shadow.color, Math.max(0.35, shadow.opacity))}`,
        }
      : kind === 'blur' && blur
        ? { filter: 'blur(1.5px)' }
        : kind === 'glow' && glow
          ? { boxShadow: `0 0 4px 1px ${hex(glow.color, Math.max(0.5, glow.opacity))}` }
          : kind === 'backdrop' && backdrop
            ? { opacity: 0.45, filter: 'blur(0.6px)' }
            : {};
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
      <span className="size-3 rounded-[3px] bg-fg-muted" style={style} />
    </span>
  );
}
