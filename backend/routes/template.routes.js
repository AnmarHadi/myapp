const express = require('express')
const router = express.Router()
const { saveTemplate, getTemplate, getTemplates, deleteTemplate } = require('../controllers/template.controller')

router.get('/', getTemplates)
router.post('/save', saveTemplate)
router.delete('/:templateName', deleteTemplate)
router.get('/:templateName', getTemplate)

module.exports = router
