import { loginAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Armarium</h1>
      <p className="mt-1 text-sm text-neutral-500">Enter the access password to continue.</p>
      <form action={loginAction} className="mt-6 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoFocus />
        </div>
        {searchParams.error ? <p className="text-sm text-red-600">Incorrect password.</p> : null}
        <Button type="submit" className="w-full">Enter</Button>
      </form>
    </main>
  );
}
