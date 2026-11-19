export interface RowClasses {
  actionRow: string;
  panel: string;
  playButton: string;
  appButtons: string;
}

interface Node {
  props?: { className?: unknown; children?: unknown };
}

export function hasClass(node: unknown, name: string): boolean {
  const classes = (node as Node | null)?.props?.className;
  return typeof classes === "string" && name !== "" && classes.split(/\s+/).includes(name);
}

export function* treeNodes(tree: unknown): Generator<Node> {
  if (Array.isArray(tree)) {
    for (const child of tree) yield* treeNodes(child);
  } else if (typeof tree === "object" && tree !== null && "props" in tree) {
    const node = tree as Node;
    yield node;
    yield* treeNodes(node.props?.children);
  }
}

export function findPlayRowInsertion(tree: unknown, classes: RowClasses) {
  for (const row of treeNodes(tree)) {
    const children = row.props?.children;
    if (!hasClass(row, classes.actionRow) || !Array.isArray(children)) continue;

    const panel = children.findIndex(
      (child) =>
        hasClass(child, classes.panel) &&
        [...treeNodes((child as Node).props?.children)].some((button) =>
          hasClass(button, classes.playButton),
        ),
    );
    const buttons = children.findIndex((child) => hasClass(child, classes.appButtons));
    if (panel >= 0 && buttons > panel) return { row, children, index: buttons + 1 };
  }
  return undefined;
}
