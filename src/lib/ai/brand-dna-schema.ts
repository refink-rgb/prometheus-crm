export type BrandDnaSource = {
  url: string
  field: string
  note: string
}

export type BrandDnaJson = {
  tagline: string
  positioning: string
  voice_adjectives: string[]
  design_agency: string
  competitive_differentiation: string
  primary_font: string
  secondary_font: string
  primary_color: string
  secondary_color: string
  accent_color: string
  background_colors: string[]
  contrast_color: string
  headline_weight: string
  body_weight: string
  cta_style: string
  lighting: string
  color_grading: string
  composition: string
  subject_matter: string
  props_and_surfaces: string
  mood: string
  packaging_description: string
  packaging_label_placement: string
  packaging_finish: string
  packaging_system: string
  typical_formats: string
  text_overlay_style: string
  ugc_usage: string
  offer_presentation: string
  core_value_prop: string
  top_pain_points: string[]
  proof_points: string[]
  common_offers: string[]
  price_anchor: string
  top_objections: string[]
  winning_hooks: string[]
  prompt_modifier: string
  sources: BrandDnaSource[]
  research_markdown: string
}

const stringField = { type: 'string' } as const
const stringArrayField = { type: 'array', items: { type: 'string' } } as const

export const brandDnaResponseSchema = {
  type: 'object',
  properties: {
    tagline: stringField,
    positioning: stringField,
    voice_adjectives: stringArrayField,
    design_agency: stringField,
    competitive_differentiation: stringField,
    primary_font: stringField,
    secondary_font: stringField,
    primary_color: stringField,
    secondary_color: stringField,
    accent_color: stringField,
    background_colors: stringArrayField,
    contrast_color: stringField,
    headline_weight: stringField,
    body_weight: stringField,
    cta_style: stringField,
    lighting: stringField,
    color_grading: stringField,
    composition: stringField,
    subject_matter: stringField,
    props_and_surfaces: stringField,
    mood: stringField,
    packaging_description: stringField,
    packaging_label_placement: stringField,
    packaging_finish: stringField,
    packaging_system: stringField,
    typical_formats: stringField,
    text_overlay_style: stringField,
    ugc_usage: stringField,
    offer_presentation: stringField,
    core_value_prop: stringField,
    top_pain_points: stringArrayField,
    proof_points: stringArrayField,
    common_offers: stringArrayField,
    price_anchor: stringField,
    top_objections: stringArrayField,
    winning_hooks: stringArrayField,
    prompt_modifier: stringField,
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: stringField,
          field: stringField,
          note: stringField,
        },
        required: ['url', 'field', 'note'],
        additionalProperties: false,
      },
    },
    research_markdown: stringField,
  },
  required: [
    'tagline',
    'positioning',
    'voice_adjectives',
    'design_agency',
    'competitive_differentiation',
    'primary_font',
    'secondary_font',
    'primary_color',
    'secondary_color',
    'accent_color',
    'background_colors',
    'contrast_color',
    'headline_weight',
    'body_weight',
    'cta_style',
    'lighting',
    'color_grading',
    'composition',
    'subject_matter',
    'props_and_surfaces',
    'mood',
    'packaging_description',
    'packaging_label_placement',
    'packaging_finish',
    'packaging_system',
    'typical_formats',
    'text_overlay_style',
    'ugc_usage',
    'offer_presentation',
    'core_value_prop',
    'top_pain_points',
    'proof_points',
    'common_offers',
    'price_anchor',
    'top_objections',
    'winning_hooks',
    'prompt_modifier',
    'sources',
    'research_markdown',
  ],
  additionalProperties: false,
} as const

export const TEXT_FIELDS = [
  'tagline',
  'positioning',
  'design_agency',
  'competitive_differentiation',
  'primary_font',
  'secondary_font',
  'primary_color',
  'secondary_color',
  'accent_color',
  'contrast_color',
  'headline_weight',
  'body_weight',
  'cta_style',
  'lighting',
  'color_grading',
  'composition',
  'subject_matter',
  'props_and_surfaces',
  'mood',
  'packaging_description',
  'packaging_label_placement',
  'packaging_finish',
  'packaging_system',
  'typical_formats',
  'text_overlay_style',
  'ugc_usage',
  'offer_presentation',
  'core_value_prop',
  'price_anchor',
  'prompt_modifier',
  'research_markdown',
] as const satisfies readonly (keyof BrandDnaJson)[]
