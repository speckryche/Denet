interface PageHeaderProps {
  title: string;
}

export function PageHeader({ title }: PageHeaderProps) {
  return (
    <header className="border-b border-white/10 bg-background/50 backdrop-blur-xl sticky top-0 z-40">
      <div className="max-w-[95%] mx-auto px-6 h-16 flex items-center">
        <h1 className="font-display font-bold text-xl tracking-tight">
          {title}
        </h1>
      </div>
    </header>
  );
}
