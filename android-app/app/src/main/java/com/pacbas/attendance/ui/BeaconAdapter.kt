package com.pacbas.attendance.ui

import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.pacbas.attendance.R
import com.pacbas.attendance.model.Beacon
import kotlin.math.roundToInt

class BeaconAdapter(
    private val onCheckInClicked: (Beacon) -> Unit
) : RecyclerView.Adapter<BeaconAdapter.BeaconViewHolder>() {

    private val beacons = mutableListOf<Beacon>()

    fun submitList(updated: Beacon) {
        val index = beacons.indexOfFirst { it.uuid == updated.uuid }
        if (index >= 0) {
            beacons[index] = updated
            notifyItemChanged(index)
        } else {
            beacons.add(updated)
            notifyItemInserted(beacons.size - 1)
        }
    }

    fun clear() {
        val size = beacons.size
        beacons.clear()
        notifyItemRangeRemoved(0, size)
    }

    fun isEmpty(): Boolean = beacons.isEmpty()

    class BeaconViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val beaconTitle: TextView = view.findViewById(R.id.textBeaconTitle)
        val majorMinorText: TextView = view.findViewById(R.id.textMajorMinor)
        val statusBadge: TextView = view.findViewById(R.id.textStatusBadge)
        val distanceText: TextView = view.findViewById(R.id.textDistance)
        val rssiText: TextView = view.findViewById(R.id.textRssi)
        val uuidText: TextView = view.findViewById(R.id.textUuid)
        val checkInButton: Button = view.findViewById(R.id.buttonCheckIn)

        val bar1: View = view.findViewById(R.id.signalBar1)
        val bar2: View = view.findViewById(R.id.signalBar2)
        val bar3: View = view.findViewById(R.id.signalBar3)
        val bar4: View = view.findViewById(R.id.signalBar4)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): BeaconViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_beacon, parent, false)
        return BeaconViewHolder(view)
    }

    override fun onBindViewHolder(holder: BeaconViewHolder, position: Int) {
        val beacon = beacons[position]
        val context = holder.itemView.context
        val distance = beacon.estimatedDistanceMeters()
        val rssi = beacon.trimmedMeanRssi().roundToInt()
        val inRange = beacon.isInRange()

        holder.beaconTitle.text = "Room ${beacon.major}-${beacon.minor}"
        holder.majorMinorText.text = "Major ${beacon.major} • Minor ${beacon.minor}"
        holder.uuidText.text = "UUID: ${beacon.uuid}"
        holder.distanceText.text = "%.1f m".format(distance)
        holder.rssiText.text = "$rssi dBm"

        // Update In-Range Status Badge
        if (inRange) {
            holder.statusBadge.text = context.getString(R.string.status_in_range)
            holder.statusBadge.setBackgroundResource(R.drawable.bg_badge_in_range)
            holder.statusBadge.setTextColor(ContextCompat.getColor(context, R.color.pacbas_in_range_text))
            holder.checkInButton.isEnabled = true
            holder.checkInButton.alpha = 1.0f
        } else {
            holder.statusBadge.text = context.getString(R.string.status_out_of_range)
            holder.statusBadge.setBackgroundResource(R.drawable.bg_badge_out_range)
            holder.statusBadge.setTextColor(ContextCompat.getColor(context, R.color.pacbas_out_range_text))
            holder.checkInButton.isEnabled = false
            holder.checkInButton.alpha = 0.5f
        }

        // Update 4-Bar Signal Indicator
        val strongColor = ContextCompat.getColor(context, R.color.signal_strong)
        val mediumColor = ContextCompat.getColor(context, R.color.signal_medium)
        val weakColor = ContextCompat.getColor(context, R.color.signal_weak)
        val inactiveColor = ContextCompat.getColor(context, R.color.signal_inactive)

        when {
            rssi >= -65 -> {
                holder.bar1.setBackgroundColor(strongColor)
                holder.bar2.setBackgroundColor(strongColor)
                holder.bar3.setBackgroundColor(strongColor)
                holder.bar4.setBackgroundColor(strongColor)
            }
            rssi >= -75 -> {
                holder.bar1.setBackgroundColor(strongColor)
                holder.bar2.setBackgroundColor(strongColor)
                holder.bar3.setBackgroundColor(strongColor)
                holder.bar4.setBackgroundColor(inactiveColor)
            }
            rssi >= -85 -> {
                holder.bar1.setBackgroundColor(mediumColor)
                holder.bar2.setBackgroundColor(mediumColor)
                holder.bar3.setBackgroundColor(inactiveColor)
                holder.bar4.setBackgroundColor(inactiveColor)
            }
            else -> {
                holder.bar1.setBackgroundColor(weakColor)
                holder.bar2.setBackgroundColor(inactiveColor)
                holder.bar3.setBackgroundColor(inactiveColor)
                holder.bar4.setBackgroundColor(inactiveColor)
            }
        }

        holder.checkInButton.setOnClickListener { onCheckInClicked(beacon) }
    }

    override fun getItemCount(): Int = beacons.size
}
