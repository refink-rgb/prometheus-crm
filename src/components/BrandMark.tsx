// The CTC logo mark used everywhere the app signs itself: sidebar, top nav,
// login, and the client-facing review header. One place to change the asset.
// The badge is a square with the letters running close to the edges, so it
// gets the same rounded-square treatment the old mark had rather than a
// circular crop.
export default function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/ctc.jpeg"
      alt="CTC"
      width={size}
      height={size}
      decoding="async"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        objectFit: 'cover',
        flexShrink: 0,
        display: 'block',
      }}
    />
  )
}
