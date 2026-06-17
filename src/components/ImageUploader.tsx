'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface UploadedImage {
  path: string
  url: string
  preview: string
}

interface ImageUploaderProps {
  onChange: (images: UploadedImage[]) => void
  value: UploadedImage[]
}

export default function ImageUploader({ onChange, value }: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setError('')

    const supabase = createClient()
    const newImages: UploadedImage[] = []

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        setError('Only image files are allowed.')
        continue
      }
      if (file.size > 10 * 1024 * 1024) {
        setError('Each image must be under 10MB.')
        continue
      }

      const ext = file.name.split('.').pop()
      const path = `product-images/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('project-images')
        .upload(path, file)

      if (uploadError) {
        setError(uploadError.message)
        continue
      }

      const { data } = supabase.storage.from('project-images').getPublicUrl(path)
      const preview = URL.createObjectURL(file)

      newImages.push({ path, url: data.publicUrl, preview })
    }

    onChange([...value, ...newImages])
    setUploading(false)
  }

  function removeImage(index: number) {
    const updated = value.filter((_, i) => i !== index)
    onChange(updated)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div>
      {/* Upload zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${value.length >= 3 ? 'var(--success)' : 'var(--border)'}`,
          borderRadius: 10,
          padding: '24px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'border-color 0.15s, background 0.15s',
          background: uploading ? 'var(--surface-raised)' : 'transparent',
          marginBottom: 12,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
        <div style={{ fontSize: 28, marginBottom: 8 }}>🖼️</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 4 }}>
          {uploading ? 'Uploading…' : 'Drag & drop or click to upload'}
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          PNG, JPG, WEBP · Max 10MB each · <strong style={{ color: value.length >= 3 ? 'var(--success)' : 'var(--accent)' }}>
            {value.length}/3 min required
          </strong>
        </p>
      </div>

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{error}</p>
      )}

      {/* Image previews */}
      {value.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
          {value.map((img, i) => (
            <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.preview || img.url}
                alt={`Product image ${i + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <button
                type="button"
                onClick={e => { e.stopPropagation(); removeImage(i) }}
                aria-label={`Remove image ${i + 1}`}
                title="Remove image"
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.7)',
                  border: 'none',
                  color: 'white',
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
