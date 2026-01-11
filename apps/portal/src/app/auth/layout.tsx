export default function AuthLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Auth pages use a minimal layout without sidebar/header
    return <>{children}</>;
}
