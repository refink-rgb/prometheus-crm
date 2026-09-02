// The CTC logo mark used everywhere the app signs itself: sidebar, top nav,
// login, and the client-facing review header. One place to change the asset.
// The source is a circular badge on a white square, so it is cropped to a
// circle to keep white corners off the dark chrome.
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
        borderRadius: '50%',
        objectFit: 'cover',
        flexShrink: 0,
        display: 'block',
      }}
    />
  )
}
