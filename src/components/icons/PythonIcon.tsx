interface PythonIconProps {
  size?: number;
}

export default function PythonIcon({ size = 48 }: PythonIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 110 110"
      width={size}
      height={size}
    >
      <defs>
        <linearGradient id="pyYellow" x1="12.959" y1="12.039" x2="70.934" y2="77.079" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#387EB8" />
          <stop offset="1" stopColor="#366994" />
        </linearGradient>
        <linearGradient id="pyBlue" x1="39.262" y1="32.959" x2="97.305" y2="97.873" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFE052" />
          <stop offset="1" stopColor="#FFC331" />
        </linearGradient>
      </defs>
      <path
        d="M54.919 0C26.727 0 28.548 12.268 28.548 12.268l.031 12.708h26.848v3.818H17.706S0 26.281 0 54.674c0 28.394 15.447 27.393 15.447 27.393h9.218V69.072s-.497-15.447 15.194-15.447h26.149s14.718.237 14.718-14.221V14.718S83.275 0 54.919 0zm-14.54 8.673a4.747 4.747 0 110 9.494 4.747 4.747 0 010-9.494z"
        fill="url(#pyYellow)"
      />
      <path
        d="M55.081 110c28.192 0 26.371-12.268 26.371-12.268l-.031-12.708H54.573v-3.818h37.721S110 83.719 110 55.326c0-28.394-15.447-27.393-15.447-27.393h-9.218v12.995s.497 15.447-15.194 15.447H44.006s-14.718-.237-14.718 14.221v24.686S26.726 110 55.081 110zm14.54-8.673a4.747 4.747 0 110-9.494 4.747 4.747 0 010 9.494z"
        fill="url(#pyBlue)"
      />
    </svg>
  );
}
