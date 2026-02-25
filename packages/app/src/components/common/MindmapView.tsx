/**
 * MindmapView — book structure mindmap visualization (placeholder)
 */

interface MindmapViewProps {
  bookId: string;
}

export function MindmapView({ bookId }: MindmapViewProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-lg font-medium text-muted-foreground">Mindmap View</p>
        <p className="text-sm text-muted-foreground">
          Visual book structure for {bookId} will render here.
        </p>
        {/* TODO: Integrate mindmap rendering library */}
      </div>
    </div>
  );
}
