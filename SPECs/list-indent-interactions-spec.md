# List Indent Interactions

## Problem

The list selection geometry revamp made bullet and task selection visually
stable, but interaction around nested list prefixes still has two rough edges:

- The leading spaces for a nesting level behave like individual invisible text
  positions instead of one predictable visual spacer.
- Pressing Tab or Shift-Tab while selecting multiple list items only consumes the
  key and does not indent or outdent the selected items.

## Behavior

- Each two-space nesting step renders as one measurable spacer unit before the
  bullet or checkbox marker.
- Spacer units remain source-backed marks over real leading spaces so deleting,
  arrowing, and selection preserve markdown semantics.
- Backspace at a spacer edge removes one nesting level.
- Tab on a multi-line list selection indents each selected bullet/task line that
  can validly move deeper.
- Shift-Tab on a multi-line list selection removes one two-space nesting level
  from each selected bullet/task line that is nested.
- Non-list lines inside the selected range are left unchanged; the command is
  consumed if at least one selected line is a list item.

## Validation

- Place the caret around nested list leading spaces and verify the nesting step
  behaves as one spacer.
- Backspace at the right edge of a nested spacer removes exactly one nesting
  level.
- Select multiple sibling list items and press Tab; each selected item indents.
- Select multiple nested list items and press Shift-Tab; each selected item
  outdents one level.
- Mixed selections leave non-list lines unchanged.
- Run `vp check` and `vp test`.
