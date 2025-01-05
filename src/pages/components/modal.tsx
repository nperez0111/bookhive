import type { Child, PropsWithChildren } from "hono/jsx";

export const Modal = ({
  id = Math.random().toString(36).substring(7),
  button,
  className,
  children,
}: PropsWithChildren<{
  id?: string;
  button: Child;
  className: string;
}>) => {
  return (
    <div className="relative">
      <input type="checkbox" id={`modal-${id}`} className="peer hidden" />
      <label htmlFor={`modal-${id}`} class={className}>
        {button}
      </label>

      {/* Modal */}
      <label
        htmlFor={`modal-${id}`}
        className="invisible fixed inset-0 z-40 bg-black/50 opacity-0 transition-all duration-200 peer-checked:visible peer-checked:opacity-100"
      />
      <div className="invisible fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 scale-75 opacity-0 transition-all duration-200 peer-checked:visible peer-checked:scale-100 peer-checked:opacity-100">
        <div className="relative w-full min-w-md rounded-lg bg-white p-6 shadow-lg dark:bg-gray-800">
          <label
            htmlFor={`modal-${id}`}
            className="absolute top-4 right-4 h-6 w-6 cursor-pointer rounded-full text-center text-gray-600 hover:bg-gray-700 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </label>
          {children}
        </div>
      </div>
    </div>
  );
};
