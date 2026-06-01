import { useState, useId } from 'react';
import './Tooltip.css';

/**
 * Glass-styled hover/focus tooltip. Wraps a single trigger element (e.g. status badge).
 */
export default function Tooltip({
  content,
  children,
  placement = 'top',
  className = '',
  variant = 'default',
  label = 'More information',
}) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();

  const show = () => setVisible(true);
  const hide = () => setVisible(false);

  const placementClass = placement === 'bottom' ? 'tooltip-placement-bottom' : 'tooltip-placement-top';
  const variantClass = variant === 'help-icon' ? 'tooltip-wrap--help-icon' : 'tooltip-wrap--default';

  const trigger = variant === 'help-icon' ? (
    <button
      type="button"
      className="tooltip-help-icon"
      aria-label={label}
      aria-describedby={visible ? tooltipId : undefined}
      onFocus={show}
      onBlur={hide}
    >
      ?
    </button>
  ) : (
    children
  );

  return (
    <span
      className={`tooltip-wrap ${variantClass} ${placementClass} ${className}`.trim()}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {variant === 'help-icon' ? (
        trigger
      ) : (
      <span
        className="tooltip-trigger"
        tabIndex={0}
        aria-describedby={visible ? tooltipId : undefined}
        onFocus={show}
        onBlur={hide}
      >
        {trigger}
      </span>
      )}
      <span
        id={tooltipId}
        role="tooltip"
        className={[
          'tooltip-bubble',
          placement === 'bottom' ? 'tooltip-bottom' : 'tooltip-top',
          visible ? 'tooltip-bubble--visible' : '',
        ].filter(Boolean).join(' ')}
      >
        {content}
      </span>
    </span>
  );
}
