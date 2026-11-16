# Cancellation Reasons — Notes for Flutter Developers (User App & Driver App)

How dynamic cancellation reasons work across the backend, admin panel, and mobile apps.  
Base URL: `https://app.rideloo.com/api/v1`  
Auth: `Authorization: Bearer <token>` (User token for rider app, Driver token for driver app)

> **Hindi (short):** Ab cancellation reasons app me hardcode **nahi** karne hain. Admin panel (**Settings > Business Settings > Cancellation Reasons**) se live manage hote hain. Admin waha naya reason add karega ya toggle karega toh app me bina kisi new release ke turant reflect hoga. App ko bas: (1) Bottom sheet kholte waqt API se reasons fetch karne hain, (2) user/driver se select karwana hai (agar `requiresNote == true` ho jaise "Other", toh extra text box dikhana hai), aur (3) ride cancel API me selected reason bhejna hai.

---

## 1. Overview & Architecture

Pehle apps me cancellation reasons hardcoded the ya fallback me "No reasons configured" aata tha. Ab poora system backend aur admin panel se connect ho chuka hai:

```
[ Admin Panel ] (Settings > Business Settings > Cancellation Reasons)
       │  (Admin can Add, Edit, Reorder, Delete, or Toggle Active)
       ▼
 [ MongoDB ] (Collection: taxicancellationreasons)
       │
       ├──► User App:   GET /api/v1/users/cancellation-reasons?audience=user
       │                     └── Ride Cancel: POST /api/v1/rides/:rideId/cancel
       │
       └──► Driver App: GET /api/v1/drivers/cancellation-reasons?audience=driver
                             └── Ride Cancel: POST /api/v1/drivers/scheduled-rides/:rideId/cancel
```

---

## 2. API Endpoints

### A. Fetch Reasons (Catalog)

#### 1. User (Rider) App
- **Endpoint:** `GET /users/cancellation-reasons?audience=user`
- **Full URL:** `https://app.rideloo.com/api/v1/users/cancellation-reasons?audience=user`
- **Auth:** Public / Bearer token (both allowed)
- **Filters:** Automatically returns only `active: true` reasons ordered by `order_by`.

#### 2. Driver App
- **Endpoint:** `GET /drivers/cancellation-reasons?audience=driver`
- **Full URL:** `https://app.rideloo.com/api/v1/drivers/cancellation-reasons?audience=driver`
- **Auth:** Public / Bearer token (both allowed)
- **Fallback:** `/users/cancellation-reasons?audience=driver` bhi same data deta hai.

---

### B. Sample API Response

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "673722a1f0a1b2c3d4e5f601",
        "_id": "673722a1f0a1b2c3d4e5f601",
        "title": "Driver asked to cancel",
        "audience": "user",
        "requiresNote": false,
        "requires_note": false,
        "order_by": 1,
        "active": true
      },
      {
        "id": "673722a1f0a1b2c3d4e5f602",
        "_id": "673722a1f0a1b2c3d4e5f602",
        "title": "Driver is taking too long to arrive",
        "audience": "user",
        "requiresNote": false,
        "requires_note": false,
        "order_by": 2,
        "active": true
      },
      {
        "id": "673722a1f0a1b2c3d4e5f607",
        "_id": "673722a1f0a1b2c3d4e5f607",
        "title": "Other reason",
        "audience": "user",
        "requiresNote": true,
        "requires_note": true,
        "order_by": 7,
        "active": true
      }
    ]
  }
}
```

> **Notice:** Both camelCase (`requiresNote`) and snake_case (`requires_note`) are sent by the backend. Similarly both `id` and `_id` are provided for compatibility.

---

### C. Ride Cancel Endpoint (Submit Reason)

#### 1. User App Cancels Ride:
- **Endpoint:** `POST /rides/:rideId/cancel`
- **Auth:** `Authorization: Bearer <userToken>`
- **Request Body:**
  ```json
  {
    "cancelReason": "Driver is taking too long to arrive",
    "reason": "Driver is taking too long to arrive"
  }
  ```
  *(Backend `cancelReason` aur `reason` dono keys accept karta hai).*

#### 2. Driver App Cancels Ride:
- **Endpoint:** `POST /drivers/scheduled-rides/:rideId/cancel`
- **Auth:** `Authorization: Bearer <driverToken>`
- **Request Body:**
  ```json
  {
    "cancelReason": "Rider did not show up"
  }
  ```

---

## 3. Dart Data Model

File: `lib/data/models/cancellation_reason_model.dart`

```dart
class CancellationReason {
  final String id;
  final String title;
  final String audience; // 'user' or 'driver'
  final bool requiresNote;
  final int orderBy;
  final bool active;

  CancellationReason({
    required this.id,
    required this.title,
    required this.audience,
    this.requiresNote = false,
    this.orderBy = 0,
    this.active = true,
  });

  factory CancellationReason.fromJson(Map<String, dynamic> json) {
    return CancellationReason(
      id: json['id']?.toString() ?? json['_id']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      audience: json['audience']?.toString() ?? 'user',
      requiresNote: json['requiresNote'] == true || json['requires_note'] == true,
      orderBy: json['order_by'] is num ? (json['order_by'] as num).toInt() : 0,
      active: json['active'] != false,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'audience': audience,
    'requiresNote': requiresNote,
    'order_by': orderBy,
    'active': active,
  };
}
```

---

## 4. Repository & Riverpod Provider

File: `lib/repositories/ride_repository.dart`

```dart
Future<List<CancellationReason>> getCancellationReasons({String audience = 'user'}) async {
  try {
    final response = await dio.get(
      '/users/cancellation-reasons',
      queryParameters: {'audience': audience},
    );

    final rawData = response.data;
    List results = [];

    if (rawData is Map<String, dynamic>) {
      if (rawData['data'] is Map<String, dynamic> && rawData['data']['results'] is List) {
        results = rawData['data']['results'];
      } else if (rawData['results'] is List) {
        results = rawData['results'];
      }
    } else if (rawData is List) {
      results = rawData;
    }

    final list = results.map((e) => CancellationReason.fromJson(e)).toList();
    list.sort((a, b) => a.orderBy.compareTo(b.orderBy));
    return list;
  } catch (e) {
    // Safety Fallback (Agar network fail ho jaye toh user at least cancel kar sake)
    return _getDefaultReasons(audience);
  }
}

List<CancellationReason> _getDefaultReasons(String audience) {
  if (audience == 'driver') {
    return [
      CancellationReason(id: '1', title: 'Rider did not show up', audience: 'driver', orderBy: 1),
      CancellationReason(id: '2', title: 'Unable to contact rider', audience: 'driver', orderBy: 2),
      CancellationReason(id: '3', title: 'Rider requested cancellation', audience: 'driver', orderBy: 3),
      CancellationReason(id: '4', title: 'Other reason', audience: 'driver', requiresNote: true, orderBy: 4),
    ];
  }
  return [
    CancellationReason(id: '1', title: 'Driver asked to cancel', audience: 'user', orderBy: 1),
    CancellationReason(id: '2', title: 'Driver is taking too long to arrive', audience: 'user', orderBy: 2),
    CancellationReason(id: '3', title: 'Wrong pickup location entered', audience: 'user', orderBy: 3),
    CancellationReason(id: '4', title: 'Change of plans', audience: 'user', orderBy: 4),
    CancellationReason(id: '5', title: 'Other reason', audience: 'user', requiresNote: true, orderBy: 5),
  ];
}
```

Riverpod Provider:
```dart
final cancellationReasonsProvider = FutureProvider.family<List<CancellationReason>, String>((ref, audience) async {
  final repo = ref.read(rideRepositoryProvider);
  return repo.getCancellationReasons(audience: audience);
});
```

---

## 5. UI Implementation (Cancel Reason Bottom Sheet)

Cancel sheet me 2 important cheezein honi chahiye:
1. **Radio options** for dynamic reasons.
2. **Dynamic Note Field**: Agar selected item ka `requiresNote == true` ho, toh niche ek `TextField` auto-appear ho jisme user likh sake.

File: `lib/presentation/widgets/cancel_reason_sheet.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/models/cancellation_reason_model.dart';

class CancelReasonSheet extends ConsumerStatefulWidget {
  final String rideId;
  final String audience; // 'user' or 'driver'
  final Future<void> Function(String finalReason) onConfirmCancel;

  const CancelReasonSheet({
    Key? key,
    required this.rideId,
    this.audience = 'user',
    required this.onConfirmCancel,
  }) : super(key: key);

  static Future<void> show(
    BuildContext context, {
    required String rideId,
    String audience = 'user',
    required Future<void> Function(String finalReason) onConfirmCancel,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => CancelReasonSheet(
        rideId: rideId,
        audience: audience,
        onConfirmCancel: onConfirmCancel,
      ),
    );
  }

  @override
  ConsumerState<CancelReasonSheet> createState() => _CancelReasonSheetState();
}

class _CancelReasonSheetState extends ConsumerState<CancelReasonSheet> {
  CancellationReason? _selectedReason;
  final TextEditingController _noteController = TextEditingController();
  bool _isSubmitting = false;

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    if (_selectedReason == null) return;

    if (_selectedReason!.requiresNote && _noteController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter reason details')),
      );
      return;
    }

    final finalReason = _selectedReason!.requiresNote && _noteController.text.trim().isNotEmpty
        ? '${_selectedReason!.title}: ${_noteController.text.trim()}'
        : _selectedReason!.title;

    setState(() => _isSubmitting = true);
    try {
      await widget.onConfirmCancel(finalReason);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to cancel: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final reasonsAsync = ref.watch(cancellationReasonsProvider(widget.audience));

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.between,
            children: [
              const Text(
                'Cancel Ride',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.black87),
              ),
              IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Please select the reason for cancelling your ride:',
            style: TextStyle(fontSize: 13, color: Colors.grey),
          ),
          const SizedBox(height: 14),

          reasonsAsync.when(
            loading: () => const Center(
              child: Padding(
                padding: EdgeInsets.all(30),
                child: CircularProgressIndicator(),
              ),
            ),
            error: (err, stack) => const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Text(
                'Could not load reasons. Please select Other or try again.',
                style: TextStyle(color: Colors.redAccent, fontSize: 13),
              ),
            ),
            data: (reasons) => ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: reasons.length,
              separatorBuilder: (_, __) => const Divider(height: 1, color: Color(0xFFF1F1F1)),
              itemBuilder: (context, index) {
                final reason = reasons[index];
                final isSelected = _selectedReason?.id == reason.id;
                return RadioListTile<CancellationReason>(
                  contentPadding: EdgeInsets.zero,
                  activeColor: const Color(0xFFFFC400),
                  title: Text(
                    reason.title,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                    ),
                  ),
                  value: reason,
                  groupValue: _selectedReason,
                  onChanged: (val) => setState(() => _selectedReason = val),
                );
              },
            ),
          ),

          if (_selectedReason?.requiresNote == true) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _noteController,
              maxLines: 2,
              decoration: InputDecoration(
                hintText: 'Type your reason here...',
                hintStyle: const TextStyle(fontSize: 13, color: Colors.grey),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: const BorderSide(color: Color(0xFFE0E0E0)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: const BorderSide(color: Color(0xFFFFC400), width: 1.5),
                ),
                contentPadding: const EdgeInsets.all(12),
              ),
            ),
          ],

          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              onPressed: (_selectedReason == null || _isSubmitting) ? null : _handleSubmit,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFFC400),
                foregroundColor: Colors.black87,
                elevation: 0,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                disabledBackgroundColor: Colors.grey.shade300,
              ),
              child: _isSubmitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black87),
                    )
                  : const Text(
                      'Cancel Ride',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
```

---

## 6. Checklist for Flutter Developers

- [x] **Remove hardcoded strings:** Reasons ko app ke andar static array me hardcode na karein, API se load karein.
- [x] **Pass audience query parameter:**
  - Rider App: `?audience=user`
  - Driver App: `?audience=driver`
- [x] **Handle `requiresNote`:** Agar selected reason me `requiresNote == true` hai (jaise "Other"), toh text input display karein aur submit me note include karein.
- [x] **Submit to Ride Cancel API:** User cancel route `POST /rides/:rideId/cancel` me `{ "cancelReason": "..." }` body bhejein.
- [x] **Offline Fallback:** Agar network connection error ho, toh fallback reasons show karein taaki user ride cancel karne me block na ho.
