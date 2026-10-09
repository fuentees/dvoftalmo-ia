interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1.5">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
        {description && <p className="text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="max-w-full shrink-0">{action}</div>}
    </div>
  );
}
