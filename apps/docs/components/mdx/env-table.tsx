import type { ReactNode } from 'react';

export function EnvRow({ role, value }: { role: string; value: string }) {
  return (
    <tr>
      <th scope="row">{role}</th>
      <td>
        <code>{value}</code>
      </td>
    </tr>
  );
}

export function EnvTable({
  children,
  caption = 'Environments',
}: {
  children: ReactNode;
  caption?: string;
}) {
  return (
    <div className="table-scroll env-table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="env-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
