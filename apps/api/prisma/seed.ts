import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting seed...\n')

  // ─── 1. Permissions ────────────────────────────────────────────────────────────
  console.log('Creating permissions...')

  const permissionDefs = [
    { resource: 'assets', action: 'create' },
    { resource: 'assets', action: 'read' },
    { resource: 'assets', action: 'update' },
    { resource: 'assets', action: 'delete' },
    { resource: 'assets', action: 'export' },
    { resource: 'assets', action: 'import' },
    { resource: 'assets', action: 'print' },
    { resource: 'movements', action: 'create' },
    { resource: 'movements', action: 'approve' },
    { resource: 'maintenance', action: 'manage' },
    { resource: 'reports', action: 'view' },
    { resource: 'reports', action: 'generate' },
    { resource: 'users', action: 'manage' },
    { resource: 'roles', action: 'manage' },
    { resource: 'audit', action: 'read' },
    { resource: 'labels', action: 'manage' },
    { resource: 'tours', action: 'manage' },
    { resource: 'categories', action: 'manage' },
    // Phase 17 — procurement batch tracking. Separate resource for
    // PurchaseOrder (commercial layer) and ProcurementBatch (receipt
    // layer) so location-scoped roles can be granted one without the
    // other if needed later.
    { resource: 'purchase-orders', action: 'read' },
    { resource: 'purchase-orders', action: 'create' },
    { resource: 'purchase-orders', action: 'update' },
    { resource: 'purchase-orders', action: 'close' },
    { resource: 'purchase-orders', action: 'cancel' },
    { resource: 'procurement', action: 'read' },
    { resource: 'procurement', action: 'create' },
    { resource: 'procurement', action: 'update' },
    { resource: 'procurement', action: 'complete' },
    { resource: 'procurement', action: 'cancel' },
    { resource: 'procurement', action: 'export' },
  ]

  const permissions: Record<string, string> = {}
  for (const perm of permissionDefs) {
    const result = await prisma.permission.upsert({
      where: { resource_action: { resource: perm.resource, action: perm.action } },
      update: {},
      create: {
        id: crypto.randomUUID(),
        resource: perm.resource,
        action: perm.action,
      },
    })
    permissions[`${perm.resource}:${perm.action}`] = result.id
  }
  console.log(`  ✓ ${Object.keys(permissions).length} permissions created\n`)

  // ─── 2. Roles ──────────────────────────────────────────────────────────────────
  console.log('Creating roles...')

  const roleDefs = [
    { name: 'SUPER_ADMIN', description: 'Full system access with all permissions' },
    { name: 'ADMIN', description: 'Administrative access without role management' },
    { name: 'MANAGER', description: 'Asset and operations management' },
    { name: 'STAFF', description: 'Basic asset operations' },
    { name: 'VIEWER', description: 'Read-only access' },
  ]

  const roles: Record<string, string> = {}
  for (const role of roleDefs) {
    const result = await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: {
        id: crypto.randomUUID(),
        name: role.name,
        description: role.description,
        isSystem: true,
      },
    })
    roles[role.name] = result.id
  }
  console.log(`  ✓ ${Object.keys(roles).length} roles created\n`)

  // ─── 3. Role-Permission assignments ────────────────────────────────────────────
  console.log('Assigning permissions to roles...')

  const allPermKeys = Object.keys(permissions)

  const rolePermissionMatrix: Record<string, string[]> = {
    SUPER_ADMIN: allPermKeys,
    ADMIN: allPermKeys.filter((k) => k !== 'roles:manage'),
    MANAGER: [
      'assets:create', 'assets:read', 'assets:update', 'assets:export', 'assets:print',
      'movements:create', 'movements:approve',
      'maintenance:manage',
      'reports:view', 'reports:generate',
      // Phase 17 procurement: MANAGER drives day-to-day pengadaan but
      // cannot cancel a PO (that's a financial/admin call).
      'purchase-orders:read', 'purchase-orders:create', 'purchase-orders:update',
      'procurement:read', 'procurement:create', 'procurement:update',
      'procurement:complete', 'procurement:export',
    ],
    STAFF: [
      'assets:read', 'assets:print',
      'movements:create',
      'reports:view',
      'purchase-orders:read', 'procurement:read',
    ],
    VIEWER: [
      'assets:read',
      'reports:view',
      'purchase-orders:read', 'procurement:read',
    ],
  }

  for (const [roleName, permKeys] of Object.entries(rolePermissionMatrix)) {
    for (const permKey of permKeys) {
      const roleId = roles[roleName]
      const permissionId = permissions[permKey]
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      })
    }
  }
  console.log('  ✓ Role-permission matrix assigned\n')

  // ─── 4. Locations ──────────────────────────────────────────────────────────────
  console.log('Creating locations...')

  const locPI = await prisma.location.upsert({
    where: { code: 'PI-JKT' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      name: 'Pondok Indah, Jakarta Selatan',
      code: 'PI-JKT',
      address: 'Jl. Metro Pondok Indah',
      city: 'Jakarta Selatan',
      province: 'DKI Jakarta',
      type: 'HEAD_OFFICE',
    },
  })

  const locPIChildren = [
    { name: 'Head Office Lantai 1', code: 'PI-HO-L1', type: 'HEAD_OFFICE' as const },
    { name: 'Head Office Lantai 2', code: 'PI-HO-L2', type: 'HEAD_OFFICE' as const },
    { name: 'Showroom Jakarta', code: 'PI-SR', type: 'SHOWROOM' as const },
    { name: 'Service Center Jakarta', code: 'PI-SC', type: 'SERVICE_CENTER' as const },
  ]

  const locationMap: Record<string, string> = { 'PI-JKT': locPI.id }

  for (const child of locPIChildren) {
    const loc = await prisma.location.upsert({
      where: { code: child.code },
      update: {},
      create: {
        id: crypto.randomUUID(),
        name: child.name,
        code: child.code,
        type: child.type,
        parentId: locPI.id,
        city: 'Jakarta Selatan',
        province: 'DKI Jakarta',
      },
    })
    locationMap[child.code] = loc.id
  }

  const locGB = await prisma.location.upsert({
    where: { code: 'GB-BDG' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      name: 'Gadobangkong, Bandung',
      code: 'GB-BDG',
      address: 'Jl. Gadobangkong',
      city: 'Bandung',
      province: 'Jawa Barat',
      type: 'BRANCH',
    },
  })
  locationMap['GB-BDG'] = locGB.id

  const locGBChildren = [
    { name: 'Showroom Bandung', code: 'GB-SR', type: 'SHOWROOM' as const },
    { name: 'Service Center Bandung', code: 'GB-SC', type: 'SERVICE_CENTER' as const },
  ]

  for (const child of locGBChildren) {
    const loc = await prisma.location.upsert({
      where: { code: child.code },
      update: {},
      create: {
        id: crypto.randomUUID(),
        name: child.name,
        code: child.code,
        type: child.type,
        parentId: locGB.id,
        city: 'Bandung',
        province: 'Jawa Barat',
      },
    })
    locationMap[child.code] = loc.id
  }
  console.log(`  ✓ ${Object.keys(locationMap).length} locations created\n`)

  // ─── 5. Asset Categories ───────────────────────────────────────────────────────
  console.log('Creating asset categories...')

  const categoryDefs = [
    { name: 'IT Equipment', code: 'IT', icon: 'monitor', color: '#3B82F6', depreciationMethod: 'STRAIGHT_LINE' as const, defaultUsefulLifeMonths: 36 },
    { name: 'Furniture', code: 'FRN', icon: 'armchair', color: '#8B5CF6', depreciationMethod: 'STRAIGHT_LINE' as const, defaultUsefulLifeMonths: 60 },
    { name: 'Vehicles', code: 'VHC', icon: 'car', color: '#EF4444', depreciationMethod: 'DECLINING_BALANCE' as const, defaultDepreciationRate: 25, defaultUsefulLifeMonths: 60 },
    { name: 'Office Supplies', code: 'OFS', icon: 'package', color: '#10B981', depreciationMethod: 'NONE' as const },
    { name: 'Electronics', code: 'ELC', icon: 'cpu', color: '#F59E0B', depreciationMethod: 'STRAIGHT_LINE' as const, defaultUsefulLifeMonths: 24 },
  ]

  const categories: Record<string, string> = {}
  for (const cat of categoryDefs) {
    const result = await prisma.assetCategory.upsert({
      where: { code: cat.code },
      update: {},
      create: {
        id: crypto.randomUUID(),
        name: cat.name,
        code: cat.code,
        icon: cat.icon,
        color: cat.color,
        depreciationMethod: cat.depreciationMethod,
        defaultDepreciationRate: cat.defaultDepreciationRate ?? null,
        defaultUsefulLifeMonths: cat.defaultUsefulLifeMonths ?? null,
      },
    })
    categories[cat.code] = result.id
  }
  console.log(`  ✓ ${Object.keys(categories).length} asset categories created\n`)

  // ─── 6. Users ──────────────────────────────────────────────────────────────────
  console.log('Creating users...')

  const passwordHash = await bcrypt.hash('password123', 12)

  const userDefs = [
    { name: 'Super Admin', email: 'superadmin@wedison.com', employeeId: 'EMP001', roleName: 'SUPER_ADMIN', locationId: undefined as string | undefined },
    { name: 'Admin User', email: 'admin@wedison.com', employeeId: 'EMP002', roleName: 'ADMIN', locationId: undefined as string | undefined },
    { name: 'Manager User', email: 'manager@wedison.com', employeeId: 'EMP003', roleName: 'MANAGER', locationId: locationMap['PI-JKT'] },
  ]

  const users: Record<string, string> = {}
  for (const u of userDefs) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        id: crypto.randomUUID(),
        name: u.name,
        email: u.email,
        passwordHash,
        employeeId: u.employeeId,
        status: 'ACTIVE',
      },
    })
    users[u.employeeId] = user.id

    // Assign role (use findFirst + create since locationId can be null in the composite unique)
    const existingUserRole = await prisma.userRole.findFirst({
      where: {
        userId: user.id,
        roleId: roles[u.roleName],
        locationId: u.locationId ?? null,
      },
    })
    if (!existingUserRole) {
      await prisma.userRole.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          roleId: roles[u.roleName],
          locationId: u.locationId ?? null,
        },
      })
    }
  }
  console.log(`  ✓ ${Object.keys(users).length} users created\n`)

  // ─── 7. Products ───────────────────────────────────────────────────────────────
  console.log('Creating products...')

  const productDefs = [
    { name: 'MacBook Pro 14', brand: 'Apple', model: 'MBP14-M3', categoryCode: 'IT' },
    { name: 'Dell Monitor 27', brand: 'Dell', model: 'U2723QE', categoryCode: 'IT' },
    { name: 'Office Desk', brand: 'IKEA', model: 'BEKANT', categoryCode: 'FRN' },
    { name: 'Ergonomic Chair', brand: 'Herman Miller', model: 'Aeron', categoryCode: 'FRN' },
    { name: 'Toyota Avanza', brand: 'Toyota', model: 'Avanza 2024', categoryCode: 'VHC' },
  ]

  const products: Record<string, string> = {}
  for (const p of productDefs) {
    // Use name + brand + model as a logical key; upsert on a generated deterministic eanCode
    const eanCode = `MAN-${p.categoryCode}-${p.model.replace(/\s+/g, '-').toUpperCase()}`
    const product = await prisma.product.upsert({
      where: { eanCode },
      update: {},
      create: {
        id: crypto.randomUUID(),
        name: p.name,
        brand: p.brand,
        model: p.model,
        categoryId: categories[p.categoryCode],
        source: 'MANUAL',
        eanCode,
      },
    })
    products[p.name] = product.id
  }
  console.log(`  ✓ ${Object.keys(products).length} products created\n`)

  // ─── 8. Assets ─────────────────────────────────────────────────────────────────
  console.log('Creating assets...')

  const superAdminId = users['EMP001']
  const adminId = users['EMP002']
  const managerId = users['EMP003']

  const assetDefs = [
    { assetNumber: 'WDS-IT-2024-00001', name: 'MacBook Pro 14 - Unit 1', productName: 'MacBook Pro 14', serialNumber: 'FVFC2M3001', locationCode: 'PI-HO-L1', status: 'ACTIVE' as const, condition: 'NEW' as const, assignedToUserId: superAdminId, purchasePrice: 35000000, purchaseDate: new Date('2024-01-15'), vendor: 'iBox Indonesia', warrantyEnd: new Date('2025-01-15') },
    { assetNumber: 'WDS-IT-2024-00002', name: 'MacBook Pro 14 - Unit 2', productName: 'MacBook Pro 14', serialNumber: 'FVFC2M3002', locationCode: 'PI-HO-L2', status: 'ACTIVE' as const, condition: 'GOOD' as const, assignedToUserId: adminId, purchasePrice: 35000000, purchaseDate: new Date('2024-01-15'), vendor: 'iBox Indonesia', warrantyEnd: new Date('2025-01-15') },
    { assetNumber: 'WDS-IT-2024-00003', name: 'Dell Monitor 27 - Unit 1', productName: 'Dell Monitor 27', serialNumber: 'DL27U2723001', locationCode: 'PI-HO-L1', status: 'ACTIVE' as const, condition: 'NEW' as const, assignedToUserId: superAdminId, purchasePrice: 8500000, purchaseDate: new Date('2024-02-01'), vendor: 'Dell Indonesia', warrantyEnd: new Date('2027-02-01') },
    { assetNumber: 'WDS-IT-2024-00004', name: 'Dell Monitor 27 - Unit 2', productName: 'Dell Monitor 27', serialNumber: 'DL27U2723002', locationCode: 'PI-HO-L2', status: 'BORROWED' as const, condition: 'GOOD' as const, assignedToUserId: managerId, purchasePrice: 8500000, purchaseDate: new Date('2024-02-01'), vendor: 'Dell Indonesia', warrantyEnd: new Date('2027-02-01') },
    { assetNumber: 'WDS-FRN-2024-00001', name: 'Office Desk - Unit 1', productName: 'Office Desk', serialNumber: null, locationCode: 'PI-HO-L1', status: 'ACTIVE' as const, condition: 'NEW' as const, assignedToUserId: null, purchasePrice: 4500000, purchaseDate: new Date('2024-01-10'), vendor: 'IKEA Indonesia', warrantyEnd: null },
    { assetNumber: 'WDS-FRN-2024-00002', name: 'Ergonomic Chair - Unit 1', productName: 'Ergonomic Chair', serialNumber: 'HM-AERON-001', locationCode: 'PI-HO-L1', status: 'ACTIVE' as const, condition: 'NEW' as const, assignedToUserId: superAdminId, purchasePrice: 25000000, purchaseDate: new Date('2024-01-10'), vendor: 'Herman Miller Official', warrantyEnd: new Date('2036-01-10') },
    { assetNumber: 'WDS-FRN-2024-00003', name: 'Ergonomic Chair - Unit 2', productName: 'Ergonomic Chair', serialNumber: 'HM-AERON-002', locationCode: 'PI-HO-L2', status: 'IN_MAINTENANCE' as const, condition: 'FAIR' as const, assignedToUserId: null, purchasePrice: 25000000, purchaseDate: new Date('2024-01-10'), vendor: 'Herman Miller Official', warrantyEnd: new Date('2036-01-10') },
    { assetNumber: 'WDS-VHC-2024-00001', name: 'Toyota Avanza - Unit 1', productName: 'Toyota Avanza', serialNumber: 'MHKA6GJ4J0001', locationCode: 'PI-JKT', status: 'ACTIVE' as const, condition: 'NEW' as const, assignedToUserId: null, purchasePrice: 270000000, purchaseDate: new Date('2024-03-01'), vendor: 'Toyota Astra Motor', warrantyEnd: new Date('2027-03-01') },
    { assetNumber: 'WDS-IT-2024-00005', name: 'MacBook Pro 14 - Unit 3', productName: 'MacBook Pro 14', serialNumber: 'FVFC2M3003', locationCode: 'GB-SR', status: 'ACTIVE' as const, condition: 'NEW' as const, assignedToUserId: null, purchasePrice: 35000000, purchaseDate: new Date('2024-04-01'), vendor: 'iBox Indonesia', warrantyEnd: new Date('2025-04-01') },
    { assetNumber: 'WDS-IT-2024-00006', name: 'Dell Monitor 27 - Unit 3', productName: 'Dell Monitor 27', serialNumber: 'DL27U2723003', locationCode: 'GB-SR', status: 'ACTIVE' as const, condition: 'NEW' as const, assignedToUserId: null, purchasePrice: 8500000, purchaseDate: new Date('2024-04-01'), vendor: 'Dell Indonesia', warrantyEnd: new Date('2027-04-01') },
  ]

  const assets: Record<string, { id: string; locationCode: string; assignedToUserId: string | null }> = {}
  for (const a of assetDefs) {
    const asset = await prisma.asset.upsert({
      where: { assetNumber: a.assetNumber },
      update: {},
      create: {
        id: crypto.randomUUID(),
        assetNumber: a.assetNumber,
        name: a.name,
        productId: products[a.productName],
        serialNumber: a.serialNumber,
        barcodeValue: a.assetNumber,
        barcodeType: 'CODE128',
        status: a.status,
        condition: a.condition,
        locationId: locationMap[a.locationCode],
        assignedToUserId: a.assignedToUserId,
        purchaseDate: a.purchaseDate,
        purchasePrice: a.purchasePrice,
        currency: 'IDR',
        vendor: a.vendor,
        warrantyStartDate: a.purchaseDate,
        warrantyEndDate: a.warrantyEnd,
        usefulLifeMonths: a.productName.includes('Avanza') ? 60 : a.productName.includes('Chair') || a.productName.includes('Desk') ? 60 : 36,
        currentBookValue: a.purchasePrice,
        createdByUserId: superAdminId,
      },
    })
    assets[a.assetNumber] = { id: asset.id, locationCode: a.locationCode, assignedToUserId: a.assignedToUserId }
  }
  console.log(`  ✓ ${Object.keys(assets).length} assets created\n`)

  // ─── 9. Asset Number Sequences ─────────────────────────────────────────────────
  console.log('Creating asset number sequences...')

  const sequences = [
    { categoryCode: 'IT', year: 2024, currentSequence: 6 },
    { categoryCode: 'FRN', year: 2024, currentSequence: 3 },
    { categoryCode: 'VHC', year: 2024, currentSequence: 1 },
  ]

  for (const seq of sequences) {
    await prisma.assetNumberSequence.upsert({
      where: { categoryCode_year: { categoryCode: seq.categoryCode, year: seq.year } },
      update: { currentSequence: seq.currentSequence },
      create: {
        id: crypto.randomUUID(),
        categoryCode: seq.categoryCode,
        year: seq.year,
        currentSequence: seq.currentSequence,
      },
    })
  }
  console.log(`  ✓ ${sequences.length} sequences created\n`)

  // ─── 10. Asset Movements ───────────────────────────────────────────────────────
  console.log('Creating asset movements...')

  let movementCounter = 0

  const makeRefNum = () => {
    movementCounter++
    return `MOV-20240115-${String(movementCounter).padStart(5, '0')}`
  }

  // INITIAL movements for each asset
  const assetEntries = Object.entries(assets)
  for (const [assetNumber, assetInfo] of assetEntries) {
    const refNum = makeRefNum()
    const existing = await prisma.assetMovement.findUnique({ where: { referenceNumber: refNum } })
    if (!existing) {
      await prisma.assetMovement.create({
        data: {
          id: crypto.randomUUID(),
          assetId: assetInfo.id,
          movementType: 'INITIAL',
          referenceNumber: refNum,
          toLocationId: locationMap[assetInfo.locationCode],
          toUserId: assetInfo.assignedToUserId,
          performedByUserId: superAdminId,
          approvedByUserId: superAdminId,
          status: 'COMPLETED',
          notes: `Initial registration of asset ${assetNumber}`,
          createdAt: new Date('2024-01-15'),
        },
      })
    }
  }

  // ASSIGNMENT: assign MacBook Unit 2 to admin
  const assignRef = 'MOV-20240201-00001'
  const existingAssign = await prisma.assetMovement.findUnique({ where: { referenceNumber: assignRef } })
  if (!existingAssign) {
    await prisma.assetMovement.create({
      data: {
        id: crypto.randomUUID(),
        assetId: assets['WDS-IT-2024-00002'].id,
        movementType: 'ASSIGNMENT',
        referenceNumber: assignRef,
        toUserId: adminId,
        toLocationId: locationMap['PI-HO-L2'],
        performedByUserId: superAdminId,
        approvedByUserId: superAdminId,
        status: 'COMPLETED',
        notes: 'Assigned MacBook Pro 14 to Admin User',
        createdAt: new Date('2024-02-01'),
      },
    })
  }

  // LOCATION_TRANSFER: move MacBook Unit 3 from PI-HO-L1 to GB-SR
  const transferRef = 'MOV-20240401-00001'
  const existingTransfer = await prisma.assetMovement.findUnique({ where: { referenceNumber: transferRef } })
  if (!existingTransfer) {
    await prisma.assetMovement.create({
      data: {
        id: crypto.randomUUID(),
        assetId: assets['WDS-IT-2024-00005'].id,
        movementType: 'LOCATION_TRANSFER',
        referenceNumber: transferRef,
        fromLocationId: locationMap['PI-HO-L1'],
        toLocationId: locationMap['GB-SR'],
        performedByUserId: adminId,
        approvedByUserId: superAdminId,
        status: 'COMPLETED',
        notes: 'Transfer MacBook to Bandung Showroom',
        createdAt: new Date('2024-04-01'),
      },
    })
  }

  // LOAN_OUT: Dell Monitor Unit 2 loaned to manager
  const loanRef = 'MOV-20240301-00001'
  const existingLoan = await prisma.assetMovement.findUnique({ where: { referenceNumber: loanRef } })
  if (!existingLoan) {
    await prisma.assetMovement.create({
      data: {
        id: crypto.randomUUID(),
        assetId: assets['WDS-IT-2024-00004'].id,
        movementType: 'LOAN_OUT',
        referenceNumber: loanRef,
        toUserId: managerId,
        toLocationId: locationMap['PI-HO-L2'],
        performedByUserId: adminId,
        approvedByUserId: superAdminId,
        status: 'COMPLETED',
        notes: 'Loaned Dell Monitor to Manager for project use',
        expectedReturnDate: new Date('2024-06-01'),
        createdAt: new Date('2024-03-01'),
      },
    })
  }

  // SEND_TO_MAINTENANCE: Ergonomic Chair Unit 2
  const maintRef = 'MOV-20240501-00001'
  const existingMaint = await prisma.assetMovement.findUnique({ where: { referenceNumber: maintRef } })
  if (!existingMaint) {
    await prisma.assetMovement.create({
      data: {
        id: crypto.randomUUID(),
        assetId: assets['WDS-FRN-2024-00003'].id,
        movementType: 'SEND_TO_MAINTENANCE',
        referenceNumber: maintRef,
        fromLocationId: locationMap['PI-HO-L2'],
        toLocationId: locationMap['PI-SC'],
        performedByUserId: adminId,
        approvedByUserId: superAdminId,
        status: 'COMPLETED',
        notes: 'Chair sent for maintenance - gas cylinder replacement',
        createdAt: new Date('2024-05-01'),
      },
    })
  }

  console.log(`  ✓ ${movementCounter + 4} asset movements created\n`)

  // ─── 11. Label Templates ───────────────────────────────────────────────────────
  console.log('Creating label templates...')

  const labelTemplate1Fields = [
    { type: 'barcode', x: 5, y: 2, width: 40, height: 12 },
    { type: 'text', field: 'asset_number', x: 5, y: 16, fontSize: 8, bold: true },
    { type: 'text', field: 'name', x: 5, y: 22, fontSize: 7, bold: false },
  ]

  const labelTemplate2Fields = [
    { type: 'qr_code', x: 5, y: 5, width: 25, height: 25 },
    { type: 'text', field: 'asset_number', x: 35, y: 5, fontSize: 10, bold: true },
    { type: 'text', field: 'name', x: 35, y: 14, fontSize: 9, bold: false },
    { type: 'text', field: 'location', x: 35, y: 22, fontSize: 8, bold: false },
    { type: 'text', field: 'assigned_to', x: 35, y: 30, fontSize: 8, bold: false },
  ]

  // Use name as the idempotent key by checking first
  const existingTemplate1 = await prisma.labelTemplate.findFirst({ where: { name: 'Standard 50x30mm' } })
  if (!existingTemplate1) {
    await prisma.labelTemplate.create({
      data: {
        id: crypto.randomUUID(),
        name: 'Standard 50x30mm',
        description: 'Standard label for small assets',
        paperWidthMm: 50,
        paperHeightMm: 30,
        isDefault: true,
        fields: labelTemplate1Fields,
        createdByUserId: superAdminId,
      },
    })
  }

  const existingTemplate2 = await prisma.labelTemplate.findFirst({ where: { name: 'Large 100x50mm' } })
  if (!existingTemplate2) {
    await prisma.labelTemplate.create({
      data: {
        id: crypto.randomUUID(),
        name: 'Large 100x50mm',
        description: 'Large label with QR code and detailed information',
        paperWidthMm: 100,
        paperHeightMm: 50,
        isDefault: false,
        fields: labelTemplate2Fields,
        createdByUserId: superAdminId,
      },
    })
  }

  console.log('  ✓ 2 label templates created\n')

  // ─── 12. Onboarding Tours ─────────────────────────────────────────────────────
  console.log('Creating onboarding tours...')

  const tourDefs = [
    {
      roleName: 'SUPER_ADMIN',
      name: 'Super Admin Onboarding',
      description: 'Complete system tour for super administrators',
      // 5 steps: dashboard, users, roles, assets, reports
      // Audit step removed — no /admin/audit page exists yet. Replaced with Reports.
      steps: [
        { step_index: 0, title: 'tours.super_admin.dashboard.title', description: 'tours.super_admin.dashboard.description', target_element: "[data-tour='dashboard-summary']", position: 'bottom', required_permission: null, route: '/dashboard', is_active: true },
        { step_index: 1, title: 'tours.super_admin.users.title',     description: 'tours.super_admin.users.description',     target_element: "[data-tour='user-management']",  position: 'right',  required_permission: { resource: 'users', action: 'manage' },  route: '/admin/users',    is_active: true },
        { step_index: 2, title: 'tours.super_admin.roles.title',     description: 'tours.super_admin.roles.description',     target_element: "[data-tour='role-management']",  position: 'right',  required_permission: { resource: 'roles', action: 'manage' },  route: '/admin/roles',    is_active: true },
        { step_index: 3, title: 'tours.super_admin.assets.title',    description: 'tours.super_admin.assets.description',    target_element: "[data-tour='asset-list']",        position: 'bottom', required_permission: { resource: 'assets', action: 'read' },   route: '/admin/assets',   is_active: true },
        { step_index: 4, title: 'tours.super_admin.reports.title',   description: 'tours.super_admin.reports.description',   target_element: "[data-tour='reports-list']",      position: 'right',  required_permission: { resource: 'reports', action: 'view' },  route: '/admin/reports',  is_active: true },
      ],
    },
    {
      roleName: 'ADMIN',
      name: 'Admin Onboarding',
      description: 'Administrative tour for system administrators',
      steps: [
        { step_index: 0, title: 'tours.admin.dashboard.title',  description: 'tours.admin.dashboard.description',  target_element: "[data-tour='dashboard-summary']", position: 'bottom', required_permission: null, route: '/dashboard', is_active: true },
        { step_index: 1, title: 'tours.admin.users.title',      description: 'tours.admin.users.description',      target_element: "[data-tour='user-management']",  position: 'right',  required_permission: { resource: 'users', action: 'manage' },  route: '/admin/users',   is_active: true },
        { step_index: 2, title: 'tours.admin.assets.title',     description: 'tours.admin.assets.description',     target_element: "[data-tour='asset-list']",        position: 'bottom', required_permission: { resource: 'assets', action: 'read' },   route: '/admin/assets',  is_active: true },
        { step_index: 3, title: 'tours.admin.reports.title',    description: 'tours.admin.reports.description',    target_element: "[data-tour='reports-list']",      position: 'right',  required_permission: { resource: 'reports', action: 'view' },  route: '/admin/reports', is_active: true },
      ],
    },
    {
      roleName: 'MANAGER',
      name: 'Manager Onboarding',
      description: 'Tour for asset and operations managers',
      steps: [
        { step_index: 0, title: 'tours.manager.dashboard.title',   description: 'tours.manager.dashboard.description',   target_element: "[data-tour='dashboard-summary']", position: 'bottom', required_permission: null, route: '/dashboard', is_active: true },
        { step_index: 1, title: 'tours.manager.assets.title',      description: 'tours.manager.assets.description',      target_element: "[data-tour='asset-list']",        position: 'bottom', required_permission: { resource: 'assets', action: 'create' },    route: '/admin/assets',      is_active: true },
        { step_index: 2, title: 'tours.manager.movements.title',   description: 'tours.manager.movements.description',   target_element: "[data-tour='movement-list']",     position: 'right',  required_permission: { resource: 'movements', action: 'approve' }, route: '/admin/movements',   is_active: true },
        { step_index: 3, title: 'tours.manager.maintenance.title', description: 'tours.manager.maintenance.description', target_element: "[data-tour='maintenance']",        position: 'right',  required_permission: { resource: 'maintenance', action: 'manage' }, route: '/admin/maintenance', is_active: true },
        { step_index: 4, title: 'tours.manager.reports.title',     description: 'tours.manager.reports.description',     target_element: "[data-tour='reports-list']",      position: 'right',  required_permission: { resource: 'reports', action: 'view' },       route: '/admin/reports',     is_active: true },
      ],
    },
    {
      roleName: 'STAFF',
      name: 'Staff Onboarding',
      description: 'Basic tour for staff members',
      steps: [
        { step_index: 0, title: 'tours.staff.dashboard.title',  description: 'tours.staff.dashboard.description',  target_element: "[data-tour='dashboard-summary']", position: 'bottom', required_permission: null, route: '/dashboard', is_active: true },
        { step_index: 1, title: 'tours.staff.assets.title',     description: 'tours.staff.assets.description',     target_element: "[data-tour='asset-list']",        position: 'bottom', required_permission: { resource: 'assets', action: 'read' },      route: '/admin/assets',    is_active: true },
        // STAFF step 2: movements list (no separate /new page; creating a movement starts from the list)
        { step_index: 2, title: 'tours.staff.movements.title',  description: 'tours.staff.movements.description',  target_element: "[data-tour='movement-list']",     position: 'right',  required_permission: { resource: 'movements', action: 'create' }, route: '/admin/movements', is_active: true },
      ],
    },
    {
      roleName: 'VIEWER',
      name: 'Viewer Onboarding',
      description: 'Read-only tour for viewers',
      steps: [
        { step_index: 0, title: 'tours.viewer.dashboard.title', description: 'tours.viewer.dashboard.description', target_element: "[data-tour='dashboard-summary']", position: 'bottom', required_permission: null, route: '/dashboard', is_active: true },
        { step_index: 1, title: 'tours.viewer.assets.title',   description: 'tours.viewer.assets.description',   target_element: "[data-tour='asset-list']",        position: 'bottom', required_permission: { resource: 'assets', action: 'read' },  route: '/admin/assets',  is_active: true },
        { step_index: 2, title: 'tours.viewer.reports.title',  description: 'tours.viewer.reports.description',  target_element: "[data-tour='reports-list']",      position: 'right',  required_permission: { resource: 'reports', action: 'view' }, route: '/admin/reports', is_active: true },
      ],
    },
  ]

  for (const tour of tourDefs) {
    const existingTour = await prisma.onboardingTour.findFirst({
      where: { roleId: roles[tour.roleName], name: tour.name },
    })
    if (!existingTour) {
      await prisma.onboardingTour.create({
        data: {
          id: crypto.randomUUID(),
          roleId: roles[tour.roleName],
          name: tour.name,
          description: tour.description,
          isActive: true,
          steps: tour.steps,
        },
      })
    }
  }

  console.log(`  ✓ ${tourDefs.length} onboarding tours created\n`)

  // ─── Done ──────────────────────────────────────────────────────────────────────
  console.log('✅ Seed completed successfully!')
  console.log('\nSummary:')
  console.log(`  - ${Object.keys(permissions).length} permissions`)
  console.log(`  - ${Object.keys(roles).length} roles`)
  console.log(`  - ${Object.keys(locationMap).length} locations`)
  console.log(`  - ${Object.keys(categories).length} asset categories`)
  console.log(`  - ${Object.keys(users).length} users`)
  console.log(`  - ${Object.keys(products).length} products`)
  console.log(`  - ${Object.keys(assets).length} assets`)
  console.log(`  - ${sequences.length} asset number sequences`)
  console.log(`  - ${movementCounter + 4} asset movements`)
  console.log(`  - 2 label templates`)
  console.log(`  - ${tourDefs.length} onboarding tours`)
  console.log('\nTest credentials:')
  console.log('  superadmin@wedison.com / password123')
  console.log('  admin@wedison.com / password123')
  console.log('  manager@wedison.com / password123')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
