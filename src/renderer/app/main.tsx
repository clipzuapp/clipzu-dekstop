import React from 'react'
import ReactDOM from 'react-dom/client'
import Layout from './layout'
import Page from './page'
import '../styles/editor.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Layout>
      <Page />
    </Layout>
  </React.StrictMode>
)
