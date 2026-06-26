export default function AppLoadingScreen({ message }) {
  return (
    <div className="app-loading-screen">
      <div className="app-loading-logo" />
      <div className="app-loading-spinner" />
      {message && <p className="app-loading-msg">{message}</p>}
    </div>
  )
}
